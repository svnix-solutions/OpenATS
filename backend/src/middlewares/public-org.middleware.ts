import type { NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { runInOrganization, unscopedDb } from "../db";
import logger from "../utils/logger";

// Public routes have no session, so nothing tells row-level security which
// tenant they are acting for and every query returns nothing. The organization
// has to come from the resource in the URL instead.

export type PublicOrgSource =
  | "job"
  | "job_slug"
  | "attempt_token"
  | "offer_token"
  | "interview_token"
  | "only";

async function resolve(
  kind: PublicOrgSource,
  identifier: string,
): Promise<number | null> {
  const result = await unscopedDb.execute<{ app_resolve_public_org: number }>(
    sql`SELECT app_resolve_public_org(${kind}, ${identifier})`,
  );
  return result.rows[0]?.app_resolve_public_org ?? null;
}

/**
 * Establishes the organization for an unauthenticated request from whatever it
 * addresses — the job being applied to, the token being redeemed.
 *
 * An unresolvable identifier is a 404 rather than a 400 or a 500: from outside,
 * "no such job" and "a job belonging to nobody" are the same thing, and saying
 * which would let someone probe for ids.
 */
export function withPublicOrganization(
  kind: PublicOrgSource,
  param?: string,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = param ? req.params[param] : "";
    const identifier = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

    if (param && !identifier) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    resolve(kind, identifier)
      .then((organizationId) => {
        if (organizationId === null) {
          res.status(404).json({ error: "Not found" });
          return;
        }

        // Same shape as authMiddleware: hold the transaction open until the
        // response ends, so every query the handler makes carries the context.
        return runInOrganization(organizationId, async () => {
          await new Promise<void>((resolve_, reject) => {
            res.on("finish", resolve_);
            res.on("close", resolve_);
            // next(), not next(err): passing anything here tells Express the
            // request failed.
            try {
              next();
            } catch (err) {
              reject(err);
            }
          });
        });
      })
      .catch((err: unknown) => {
        logger.error("[publicOrg] failed to establish context:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" });
        }
      });
  };
}

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { orgContext } from "./org-context";
import logger from "../utils/logger";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  logger.warn("[pg pool] idle client error (connection dropped):", err.message);
});

const rootDb = drizzle(pool, { schema });

type Db = typeof rootDb;

// A client-bound handle differs from the pool-bound one only in `$client`,
// which nothing in the app touches.
type ScopedDb = Omit<Db, "$client">;


/**
 * The database handle every module imports.
 *
 * Inside `runInOrganization` it resolves to that request's transaction, so
 * queries are filtered by policy and inserts pick up `organization_id` from
 * the column default. Outside one it is the plain pool, which every policy
 * then evaluates against a null organization — meaning no rows. Reads fail
 * closed rather than leaking, and writes are rejected outright.
 */
export const db = new Proxy(rootDb, {
  get(target, property, receiver) {
    // The store types `scoped` loosely so that org-context.ts can stay free
    // of db imports; this is the one place that knows what it really is.
    const active: ScopedDb =
      (orgContext.getStore()?.scoped as ScopedDb | undefined) ?? target;
    const value = Reflect.get(active, property, receiver);
    return typeof value === "function" ? value.bind(active) : value;
  },
}) as Db;

/**
 * Runs `fn` with every query scoped to one organization.
 *
 * Deliberately NOT a transaction around the whole callback. An HTTP request
 * writes its response from inside this callback, so a wrapping transaction
 * would commit only after the response had already been flushed — the client
 * would see a 200 for work that had not been committed yet, and a read issued
 * straight afterwards would return the old row. Worse, a commit that then
 * failed would have no way to un-send the response.
 *
 * Instead the setting is session-scoped on a connection checked out for the
 * duration, so each statement commits as it runs, exactly as it did before
 * tenancy. Callers that want atomicity still use `db.transaction`, which now
 * nests on this same connection.
 */
export async function runInOrganization<T>(
  organizationId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let poisoned = false;

  try {
    await client.query("SELECT set_config('app.org_id', $1, false)", [
      String(organizationId),
    ]);
    const scoped = drizzle(client, { schema });
    return await orgContext.run({ scoped, organizationId }, fn);
  } finally {
    try {
      // Clearing this matters more than it looks: a connection handed back
      // still carrying an organization would silently scope whatever request
      // picks it up next.
      await client.query("SELECT set_config('app.org_id', '', false)");
    } catch {
      // If it cannot be cleared, it must not go back in the pool.
      poisoned = true;
    }
    client.release(poisoned);
  }
}

/**
 * Resolves an Asgardeo subject to their membership, bypassing row-level
 * security because login happens before any organization is known.
 *
 * The one deliberate hole in the boundary, kept narrow on purpose: the
 * underlying function is SECURITY DEFINER, takes a subject, and returns ids
 * and a role and nothing else.
 */
export async function resolveMembership(asgardeoUserId: string): Promise<{
  userId: number;
  organizationId: number;
  role: string;
  clientCompanyId: number | null;
} | null> {
  const result = await rootDb.execute<{
    user_id: number;
    organization_id: number;
    role: string;
    client_company_id: number | null;
  }>(sql`SELECT * FROM app_resolve_membership(${asgardeoUserId})`);

  const row = result.rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    organizationId: row.organization_id,
    role: row.role,
    clientCompanyId: row.client_company_id,
  };
}

/** Escape hatch for migrations, seeding and tests. Bypasses the proxy. */
export const unscopedDb = rootDb;

// Re-exported so the many modules importing it from here keep working; it
// lives in org-context.ts to keep the logger able to read it.
export { currentOrganizationId } from "./org-context";

export * from "./schema";

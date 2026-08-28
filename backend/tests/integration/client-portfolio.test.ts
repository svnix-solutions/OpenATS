import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";

import { db, runInOrganization } from "../../src/db";
import { clientCompanies } from "../../src/db/schema/organizations";
import { listPublicClientCompanies } from "../../src/modules/job/job.controller";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * `/public/clients` is what an agency's own website reads to show the
 * companies it recruits for. It already returned the name and slug — the slug
 * because the bare /careers page uses it to choose a company — and now the
 * brand mark and the company's own site, which is what makes it a portfolio
 * rather than a routing table.
 *
 * It is public and unauthenticated, so what it carries is a decision rather
 * than a convenience: no description, and nothing about the relationship.
 *
 * Driven through the handler rather than over HTTP, because the route is
 * mounted behind `withPublicOrganization("only")` — it resolves the tenant
 * only where exactly one organization exists, and the test database has one
 * per scenario. That is the route's real limitation, not the test's: on a
 * multi-agency install this endpoint answers 404, because nothing in the URL
 * says whose clients are being asked for.
 */

/** Runs the handler and hands back what it wrote. */
async function callHandler() {
  let payload: unknown;
  let status = 0;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  } as unknown as Response;

  await listPublicClientCompanies({} as Request, res);
  return { status, body: payload as { data: Record<string, unknown>[] } };
}

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("portfolio");
  await runInOrganization(s.organizationId, () =>
    db
      .update(clientCompanies)
      .set({
        logoUrl: "https://cdn.example.test/acme.png",
        website: "https://acme.example.test",
      })
      .where(eq(clientCompanies.id, s.clientCompanyId)),
  );
});

afterAll(async () => {
  await destroyScenario(s);
});

describe("the public client list", () => {
  itInOrg("carries the logo and the company's own site", async () => {
    const res = await callHandler();

    expect(res.status).toBe(200);
    const mine = res.body.data.find((c) => c.slug === s.suffix);

    expect(mine).toMatchObject({
      logoUrl: "https://cdn.example.test/acme.png",
      website: "https://acme.example.test",
    });
  });

  itInOrg("carries nothing else about the client", async () => {
    const [first] = (await callHandler()).body.data;

    // Unauthenticated. A field added here is published to anyone who asks,
    // so the shape is pinned rather than left to whatever the query selects.
    expect(Object.keys(first ?? {}).sort()).toEqual(
      ["logoUrl", "name", "slug", "website"].sort(),
    );
  });

  itInOrg("shows only this organization's clients", async () => {
    // The handler has no tenant filter of its own — row-level security is the
    // filter. Worth pinning on a public endpoint, where a missing WHERE would
    // publish every agency's client list to anyone who asked.
    const slugs = (await callHandler()).body.data.map((c) => c.slug);
    expect(slugs).toEqual([s.suffix]);
  });
});

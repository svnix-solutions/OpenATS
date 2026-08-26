import { describe, it, expect, afterAll } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { unscopedDb } from "../../src/db";
import { provision, parseArgs } from "../../src/db/provision-org";

/**
 * Provisioning is the only way a second agency comes into existence, and it is
 * the one write in the codebase that deliberately runs outside the tenancy
 * boundary. What is worth pinning down is not that it inserts a row — it is
 * that the organization it leaves behind is reachable: someone can sign in to
 * it, and the placeholder identity it created gets replaced by a real one.
 */

const SUFFIX = `prov-${Date.now()}`;
const SLUG = `${SUFFIX}`;
const ADMIN = `admin.${SUFFIX}@example.test`;

async function owner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

afterAll(async () => {
  await owner(async (c) => {
    await c.query("DELETE FROM organizations WHERE slug LIKE $1", [`${SUFFIX}%`]);
    await c.query("DELETE FROM users WHERE email = $1", [ADMIN]);
  });
});

describe("provisioning a new organization", () => {
  it("creates one that is immediately usable", async () => {
    await provision({
      name: "Provisioned Agency",
      slug: SLUG,
      providerOrgId: null,
      admin: ADMIN,
    });

    const state = await owner(async (c) => {
      const org = await c.query<{ id: number }>(
        "SELECT id FROM organizations WHERE slug = $1",
        [SLUG],
      );
      const id = org.rows[0]!.id;
      const stages = await c.query<{ count: string }>(
        "SELECT count(*) FROM pipeline_stage_templates WHERE organization_id = $1",
        [id],
      );
      const member = await c.query<{ role: string; email: string }>(
        `SELECT m.role, u.email FROM organization_members m
         JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1`,
        [id],
      );
      return {
        id,
        stages: Number(stages.rows[0]!.count),
        member: member.rows[0],
      };
    });

    // Without stages the pipeline has nowhere to put an applicant, and without
    // a member nobody can sign in: either one alone is not a usable tenant.
    expect(state.stages).toBe(7);
    expect(state.member).toEqual({ role: "super_admin", email: ADMIN });
  });

  it("hands the placeholder identity over to the real one on first sign-in", async () => {
    const pendingId = await owner(async (c) => {
      const row = await c.query<{ id: number; provider_user_id: string }>(
        "SELECT id, provider_user_id FROM users WHERE email = $1",
        [ADMIN],
      );
      expect(row.rows[0]!.provider_user_id).toMatch(/^pending:/);
      return row.rows[0]!.id;
    });

    // What the auth middleware does on a first request.
    const realSub = `sub-${SUFFIX}`;
    await unscopedDb.execute(
      sql`SELECT * FROM app_provision_user(${realSub}, ${ADMIN}, 'Real', 'Admin')`,
    );

    const after = await owner(async (c) =>
      (
        await c.query<{ id: number; provider_user_id: string }>(
          "SELECT id, provider_user_id FROM users WHERE email = $1",
          [ADMIN],
        )
      ).rows[0]!,
    );

    // The same row, not a second one: a duplicate would break the unique email
    // constraint the reconciliation branch exists to avoid.
    expect(after.id).toBe(pendingId);
    expect(after.provider_user_id).toBe(realSub);

    const membership = await unscopedDb.execute<{ organization_id: number }>(
      sql`SELECT * FROM app_resolve_membership(${realSub})`,
    );
    const org = await owner(async (c) =>
      (
        await c.query<{ id: number }>(
          "SELECT id FROM organizations WHERE slug = $1",
          [SLUG],
        )
      ).rows[0]!.id,
    );
    expect(membership.rows[0]?.organization_id).toBe(org);
  });

  it("refuses a slug that is already taken", async () => {
    await expect(
      provision({
        name: "Another",
        slug: SLUG,
        providerOrgId: null,
        admin: null,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("refuses a slug that would not survive a URL", () => {
    expect(() => parseArgs(["--name", "X", "--slug", "Acme Corp!"])).toThrow(
      /Invalid slug/,
    );
  });
});

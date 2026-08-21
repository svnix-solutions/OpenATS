import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { db, unscopedDb, runInOrganization } from "../../src/db";

// The isolation sweep from decisions/0002 §2 step 3.
//
// 0001 originally proposed one hand-written test per table. That does not
// survive a growing schema: the table someone adds in six months is exactly
// the one nobody writes the test for, and a missing test looks identical to a
// passing suite. So this reads the catalog instead. A table added without a
// policy fails here without anyone having to remember anything.

type Row = Record<string, unknown>;

async function catalog<T extends Row>(query: ReturnType<typeof sql>) {
  const result = await unscopedDb.execute<T>(query);
  return result.rows;
}

describe("every table is covered by row-level security", () => {
  it("has at least the tables we expect, so an empty sweep cannot pass", async () => {
    // Guards against the sweep silently testing nothing if the catalog query
    // breaks or the schema is empty.
    const rows = await catalog<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    expect(rows[0]!.count).toBeGreaterThan(30);
  });

  it("enables and forces row-level security on every base table", async () => {
    const rows = await catalog<{ tablename: string }>(
      sql`SELECT t.tablename
          FROM pg_tables t
          JOIN pg_class c ON c.relname = t.tablename
          JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
          WHERE t.schemaname = 'public'
            AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
          ORDER BY t.tablename`,
    );

    // FORCE matters as much as ENABLE: without it the table owner reads
    // straight past every policy.
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("has an isolation policy on every base table", async () => {
    const rows = await catalog<{ table_name: string }>(
      sql`SELECT t.table_name
          FROM information_schema.tables t
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND NOT EXISTS (
              SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = t.table_name
            )
          ORDER BY t.table_name`,
    );

    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("gives every write-permitting policy a WITH CHECK clause", async () => {
    // USING filters reads. Without WITH CHECK, a tenant can still write a row
    // stamped with another tenant's id, or move one of its own across.
    // SELECT and DELETE policies have no WITH CHECK by definition, so only
    // ALL, INSERT and UPDATE are relevant.
    const rows = await catalog<{ tablename: string }>(
      sql`SELECT tablename FROM pg_policies
          WHERE schemaname = 'public'
            AND cmd IN ('ALL', 'INSERT', 'UPDATE')
            AND with_check IS NULL
          ORDER BY tablename`,
    );

    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("carries organization_id on every table except the three that cannot", async () => {
    const rows = await catalog<{ table_name: string }>(
      sql`SELECT t.table_name
          FROM information_schema.tables t
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND t.table_name NOT IN ('organizations', 'users', '__drizzle_migrations')
            AND NOT EXISTS (
              SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema = 'public'
                AND c.table_name = t.table_name
                AND c.column_name = 'organization_id'
            )
          ORDER BY t.table_name`,
    );

    // organizations keys on its own id; users is a global identity scoped
    // through organization_members. Everything else carries the column.
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("defaults organization_id from the session on every scoped table", async () => {
    // This default is what lets existing INSERT statements keep working
    // untouched: the column fills itself from the request's context.
    const rows = await catalog<{ table_name: string }>(
      sql`SELECT c.table_name
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.column_name = 'organization_id'
            AND (c.column_default IS NULL
                 OR c.column_default NOT LIKE '%app_current_org%')
          ORDER BY c.table_name`,
    );

    // client_companies and organization_members are inserted with an explicit
    // organization, so they are allowed to have no default.
    expect(rows.map((r) => r.table_name)).toEqual([
      "client_companies",
      "organization_members",
    ]);
  });
});

// Creating an organization is deliberately impossible through the application
// role: `organizations` carries WITH CHECK (id = app_current_org()), so no
// tenant can bring another into existence. Provisioning an agency is a
// platform operation performed with elevated credentials, the same way the
// application role itself is provisioned. These tests therefore seed through
// an owner connection.
let owner: Client;
let orgA: number;
let orgB: number;

beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required by this suite");
  owner = new Client({ connectionString: url });
  await owner.connect();

  const tag = `rls-${Date.now()}`;
  const ids: number[] = [];
  for (const label of ["A", "B"]) {
    const org = await owner.query<{ id: number }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Org ${label} ${tag}`, `${tag}-${label.toLowerCase()}`],
    );
    const id = org.rows[0]!.id;
    ids.push(id);
    await owner.query(
      `INSERT INTO company (name, email, organization_id) VALUES ($1, $2, $3)`,
      [`Org ${label} company`, `${tag}-${label}@example.test`, id],
    );
  }
  [orgA, orgB] = ids as [number, number];
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    await owner.query(`DELETE FROM company WHERE organization_id = $1`, [id]);
    await owner.query(`DELETE FROM organizations WHERE id = $1`, [id]);
  }
  await owner.end();
});

describe("the boundary holds against real rows", () => {
  const companyNames = async (organizationId: number) =>
    runInOrganization(organizationId, async () => {
      const rows = await db.execute<{ name: string }>(
        sql`SELECT name FROM company`,
      );
      // Sorted here rather than in SQL: database collation differs between a
      // developer's machine and the CI runner.
      return rows.rows.map((r) => r.name).sort();
    });

  it("shows each organization only its own rows", async () => {
    expect(await companyNames(orgA)).toEqual(["Org A company"]);
    expect(await companyNames(orgB)).toEqual(["Org B company"]);
  });

  it("returns nothing at all with no organization context", async () => {
    const rows = await db.execute<{ name: string }>(
      sql`SELECT name FROM company`,
    );
    expect(rows.rows).toEqual([]);
  });

  it("refuses a write stamped with another organization's id", async () => {
    await expect(
      runInOrganization(orgA, () =>
        db.execute(
          sql`INSERT INTO company (name, email, organization_id)
              VALUES ('smuggled', 'smuggled@example.test', ${orgB})`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("stamps a write with the acting organization without being told", async () => {
    await runInOrganization(orgA, () =>
      db.execute(
        sql`INSERT INTO company (name, email) VALUES ('implicit', 'implicit@example.test')`,
      ),
    );

    expect(await companyNames(orgA)).toEqual(
      ["Org A company", "implicit"].sort(),
    );
    // ...and it did not appear for anyone else.
    expect(await companyNames(orgB)).toEqual(["Org B company"]);
  });

  it("cannot reach another organization's rows even by primary key", async () => {
    const bRow = await owner.query<{ id: number }>(
      `SELECT id FROM company WHERE organization_id = $1 LIMIT 1`,
      [orgB],
    );
    const targetId = bRow.rows[0]!.id;

    const found = await runInOrganization(orgA, async () => {
      const rows = await db.execute(
        sql`SELECT id FROM company WHERE id = ${targetId}`,
      );
      return rows.rows;
    });

    expect(found).toEqual([]);
  });
});

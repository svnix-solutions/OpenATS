import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { db } from "../../src/db";

// Row-level security is bypassed unconditionally by superusers, and by table
// owners unless the table is FORCEd. An application connecting as either one
// ignores every policy silently — the queries succeed, they just return
// everything. Isolation tests written against such a connection pass without
// testing anything, which is worse than having no tests, because a green suite
// is read as evidence.
//
// These tests are the guard against that. If someone repoints DATABASE_URL at
// the owner, this file fails immediately and says why.

const PROBE = "rls_role_probe";

let owner: Client;

beforeAll(async () => {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is required by this suite");

  owner = new Client({ connectionString: url });
  await owner.connect();

  await owner.query(`DROP TABLE IF EXISTS ${PROBE}`);
  await owner.query(`CREATE TABLE ${PROBE} (id serial primary key, org_id int)`);
  await owner.query(`INSERT INTO ${PROBE} (org_id) VALUES (100), (200)`);
  await owner.query(`ALTER TABLE ${PROBE} ENABLE ROW LEVEL SECURITY`);
  await owner.query(`ALTER TABLE ${PROBE} FORCE ROW LEVEL SECURITY`);
  // NULLIF is load-bearing. Once app.org_id has been set in a session,
  // current_setting(..., true) returns '' rather than NULL when it is no
  // longer set, and ''::int raises 22P02 instead of matching no rows. The
  // policy would then throw on exactly the request that forgot its context,
  // which is a crash where the whole point was to fail closed and return
  // nothing. Phase 1's real policies need this same guard.
  await owner.query(
    `CREATE POLICY org_isolation ON ${PROBE}
       USING (org_id = NULLIF(current_setting('app.org_id', true), '')::int)`,
  );
  await owner.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${PROBE} TO openats_app`,
  );
});

afterAll(async () => {
  await owner.query(`DROP TABLE IF EXISTS ${PROBE}`);
  await owner.end();
});

describe("the role the application connects as", () => {
  it("is not a superuser", async () => {
    const result = await db.execute<{ is_superuser: boolean }>(
      sql`SELECT usesuper AS is_superuser FROM pg_user WHERE usename = current_user`,
    );
    expect(result.rows[0]?.is_superuser).toBe(false);
  });

  it("does not own the tables it reads", async () => {
    const result = await db.execute<{ owns: number }>(
      sql`SELECT count(*)::int AS owns
          FROM pg_tables
          WHERE schemaname = 'public' AND tableowner = current_user`,
    );
    expect(result.rows[0]?.owns).toBe(0);
  });

  it("cannot create tables, so it cannot escape a policy by replacing one", async () => {
    // Drizzle wraps driver errors in its own "Failed query" message, so the
    // assertion has to reach the pg error underneath. 42501 is
    // insufficient_privilege.
    const error = await db
      .execute(sql`CREATE TABLE should_not_exist (id int)`)
      .then(
        () => null,
        (e: unknown) => e as { cause?: { code?: string } },
      );

    expect(error).not.toBeNull();
    expect(error?.cause?.code).toBe("42501");
  });
});

describe("row-level security actually applies to that role", () => {
  async function readProbeAs(orgId: number | null) {
    return db.transaction(async (tx) => {
      if (orgId !== null) {
        // SET LOCAL, not SET: a bare SET outlives the transaction and rides
        // the pooled connection into whatever request is served next.
        await tx.execute(sql`SELECT set_config('app.org_id', ${String(orgId)}, true)`);
      }
      const result = await tx.execute<{ org_id: number }>(
        sql`SELECT org_id FROM rls_role_probe ORDER BY org_id`,
      );
      return result.rows.map((r) => r.org_id);
    });
  }

  it("shows only the rows belonging to the current organization", async () => {
    expect(await readProbeAs(100)).toEqual([100]);
    expect(await readProbeAs(200)).toEqual([200]);
  });

  it("fails closed when no organization context is set", async () => {
    expect(await readProbeAs(null)).toEqual([]);
  });

  it("does not leak context to the next user of a pooled connection", async () => {
    // Enough sequential round trips to be near-certain of reusing a connection
    // that previously carried a context.
    for (let i = 0; i < 12; i++) {
      await readProbeAs(100);
      expect(await readProbeAs(null)).toEqual([]);
    }
  });

  it("keeps concurrent requests for different organizations apart", async () => {
    const work = Array.from({ length: 24 }, (_, i) =>
      i % 2 === 0
        ? readProbeAs(100).then((rows) => ({ want: 100, rows }))
        : readProbeAs(200).then((rows) => ({ want: 200, rows })),
    );

    for (const { want, rows } of await Promise.all(work)) {
      expect(rows).toEqual([want]);
    }
  });
});

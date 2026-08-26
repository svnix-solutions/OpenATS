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

/**
 * Refuses to run as a role that row-level security does not apply to.
 *
 * The entire tenancy boundary is policies on tables. Postgres exempts
 * superusers and any role with BYPASSRLS from them — `FORCE ROW LEVEL
 * SECURITY` closes the owner loophole but not this one — so a connection made
 * as such a role reads and writes every tenant's rows while every query,
 * every test and every log line looks exactly as it should. There is no
 * symptom until someone sees another company's candidates.
 *
 * That is not hypothetical: the E2E suite pointed `DATABASE_URL` at the
 * database owner, which is a superuser, and ran for months unable to observe
 * a tenancy failure at all.
 *
 * Being the table *owner* is fine — the policies are FORCEd, so they apply.
 * Only the two exemptions are refused.
 */
export type ConnectionRole = {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
};

/** The complaint about a role, or null when it is one policies apply to. */
export function rlsExemption(role: ConnectionRole): string | null {
  if (!role.rolsuper && !role.rolbypassrls) return null;

  const why = role.rolsuper ? "a superuser" : "BYPASSRLS";
  return (
    `DATABASE_URL connects as "${role.rolname}", which is ${why}. ` +
    "Row-level security does not apply to such a role, so every tenancy " +
    "policy would be silently ignored and organizations would see each " +
    "other's data. Use the least-privileged application role " +
    "(openats_app); the owner belongs in MIGRATION_DATABASE_URL only."
  );
}

/** Narrow enough for a test to stand in for the pool. */
type RoleQueryable = {
  query: <T>(text: string) => Promise<{ rows: T[] }>;
};

export async function assertTenancyIsEnforceable(
  queryable: RoleQueryable = pool as unknown as RoleQueryable,
): Promise<void> {
  const { rows } = await queryable.query<ConnectionRole>(
    `SELECT rolname, rolsuper, rolbypassrls
     FROM pg_roles WHERE rolname = current_user`,
  );

  const role = rows[0];
  if (!role) return;

  const complaint = rlsExemption(role);
  if (complaint) throw new Error(complaint);
}

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
 * Resolves a provider subject to their membership, bypassing row-level
 * security because login happens before any organization is known.
 *
 * The one deliberate hole in the boundary, kept narrow on purpose: the
 * underlying function is SECURITY DEFINER, takes a subject, and returns ids
 * and a role and nothing else.
 */
export async function resolveMembership(providerUserId: string): Promise<{
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
  }>(sql`SELECT * FROM app_resolve_membership(${providerUserId})`);

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

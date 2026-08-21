import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
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
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The transaction the current request is running inside, if any.
 *
 * Row-level security reads the organization from a session setting, and that
 * setting has to be transaction-local — a bare `SET` outlives the statement
 * and rides the pooled connection into whatever request is served next, which
 * is a cross-tenant read. Holding the transaction here means every query a
 * request makes lands on the connection that carries its context, without a
 * single service having to thread it through.
 */
const orgContext = new AsyncLocalStorage<Tx>();

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
    const active: Db | Tx = orgContext.getStore() ?? target;
    const value = Reflect.get(active, property, receiver);
    return typeof value === "function" ? value.bind(active) : value;
  },
}) as Db;

/** Runs `fn` with every query scoped to one organization. */
export async function runInOrganization<T>(
  organizationId: number,
  fn: () => Promise<T>,
): Promise<T> {
  return rootDb.transaction(async (tx) => {
    // Transaction-local (the `true` argument), so it is discarded when the
    // connection returns to the pool.
    await tx.execute(
      sql`SELECT set_config('app.org_id', ${String(organizationId)}, true)`,
    );
    return orgContext.run(tx, fn);
  });
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

export * from "./schema";

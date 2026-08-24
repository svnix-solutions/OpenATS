import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The tenancy context for the current request, socket event, or job.
 *
 * This lives apart from `db/index.ts` for one reason: `db/index.ts` imports
 * the logger, so the logger cannot import it back to stamp lines with the
 * organization they came from. Nothing here imports anything but Node, which
 * is what keeps that possible.
 *
 * `scoped` is the drizzle handle bound to the connection carrying the
 * `app.org_id` setting. It is typed loosely here on purpose — naming the
 * drizzle type would pull the schema in and rebuild the cycle this exists to
 * break. `db/index.ts` owns that type and casts once.
 */
export interface RequestContext {
  scoped: unknown;
  organizationId: number;
}

export const orgContext = new AsyncLocalStorage<RequestContext>();

/**
 * The organization the current request is acting for, or null outside one.
 *
 * Anything that keys a cache, a file path or a queue job needs this: row-level
 * security scopes the *rows*, and cannot help with state the application keeps
 * beside them.
 */
export function currentOrganizationId(): number | null {
  return orgContext.getStore()?.organizationId ?? null;
}

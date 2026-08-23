import { serverFetch } from "./auth-action";

export type AppRole =
  | "super_admin"
  | "hiring_manager"
  | "interviewer"
  | "client_admin"
  | "client_reviewer";

/**
 * Refuses the request unless the signed-in user holds this role.
 *
 * Asks the backend rather than decoding the token here. This file used to
 * verify the JWT and map its claims to a role itself — a second copy of logic
 * the backend already owns, which drifted twice: it kept a substring match on
 * "super admin" that the backend had removed and documented against, and it
 * did not know the two client roles existed.
 *
 * One mapping, in the place that also enforces it.
 */
export async function requireRole(required: AppRole): Promise<void> {
  const me = await serverFetch<{ data: { role: AppRole } }>("/api/users/me");

  if (me.data.role !== required) {
    throw new Error("Forbidden");
  }
}

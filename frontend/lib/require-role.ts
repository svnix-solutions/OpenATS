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
  // "/users/me", not "/api/users/me": apiFetch prepends /api itself. With the
  // prefix doubled this requested /api/api/users/me, got a 404, and threw —
  // so every call to requireRole failed, and every route guarded by it
  // answered 500 rather than enforcing anything.
  const me = await serverFetch<{ data: { role: AppRole } }>("/users/me");

  if (me.data.role !== required) {
    throw new Error("Forbidden");
  }
}

import type { AppRole } from "./require-role";

/**
 * Whether this role belongs to a contact at a client company rather than
 * agency staff.
 *
 * The same `role === "client_admin" || role === "client_reviewer"` test was
 * written out in four places, which is three chances for a fifth to be added
 * and missed. The backend keeps the matching rule in one function too — see
 * `isClientScoped` in `shared/auth/job-access.ts`.
 */
export function isClientRole(role: AppRole | string | undefined): boolean {
  return role === "client_admin" || role === "client_reviewer";
}

/**
 * The routes a client contact may open.
 *
 * The sidebar hides everything else, but hiding a link is not a control: the
 * URL is still typeable, and the page behind it renders empty or errors
 * because the endpoints refuse them. This list is what `ClientRouteGate`
 * enforces, and it is the same set the sidebar filters against.
 *
 * `/settings/profile` is on it because it is theirs, not the agency's.
 */
export const CLIENT_ROUTES = [
  "/jobs",
  "/candidates",
  "/interviews",
  "/settings/profile",
] as const;

/** The client portal's landing page — where a client is sent by default. */
export const CLIENT_HOME = "/jobs";

export function isClientRoute(pathname: string): boolean {
  return CLIENT_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

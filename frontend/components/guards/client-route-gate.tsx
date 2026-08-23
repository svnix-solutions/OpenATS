"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/queries/use-user";
import { CLIENT_HOME, isClientRole, isClientRoute } from "@/lib/roles";

/**
 * Keeps a client contact inside the client portal.
 *
 * The sidebar already hides agency tooling from them, but a hidden link is
 * not a control — the URL is still typeable, and a client who lands on one
 * gets an empty or broken page rather than an answer, because the endpoints
 * behind it refuse them. This turns that into a redirect.
 *
 * It is not the security boundary and is not trying to be: that is
 * `denyClients` and the row-level policies on the backend, which is where a
 * control belongs. This is so the product behaves.
 */
export function ClientRouteGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, isSuccess } = useCurrentUser();

  const role = data?.data?.role;
  // Until the role is known, redirecting would bounce agency staff off their
  // own dashboard on every cold load.
  const misplaced =
    isSuccess && isClientRole(role) && pathname && !isClientRoute(pathname);

  useEffect(() => {
    if (misplaced) router.replace(CLIENT_HOME);
  }, [misplaced, router]);

  return <>{children}</>;
}

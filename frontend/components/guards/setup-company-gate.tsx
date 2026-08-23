"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

//import { useCompany, useDepartments } from "@/hooks/use-api";
import { useCompany, useDepartments } from "@/hooks/queries/use-company";
import { useCurrentUser } from "@/hooks/queries/use-user";
import { isClientRole } from "@/lib/roles";

const ALLOWED_WITHOUT_SETUP = /^\/settings\/general(\/|$)/;

export function SetupCompanyGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: companyData, isSuccess: companyReady } = useCompany();
  const { data: deptData, isSuccess: deptReady } = useDepartments();
  const { data: me } = useCurrentUser();

  // A client contact cannot set up the agency's company, so sending them to
  // do it strands them on a settings page they are refused — and bounces them
  // against ClientRouteGate, which sends them straight back.
  const isClient = isClientRole(me?.data?.role);

  const hasCompany = companyData?.data != null;
  const hasDepartments = (deptData?.data?.length ?? 0) > 0;
  const needsSetup =
    !isClient && companyReady && deptReady && (!hasCompany || !hasDepartments);

  useEffect(() => {
    if (!needsSetup) return;
    if (pathname && ALLOWED_WITHOUT_SETUP.test(pathname)) return;
    router.replace("/settings/general");
  }, [needsSetup, pathname, router]);

  return <>{children}</>;
}

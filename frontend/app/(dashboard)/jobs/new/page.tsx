"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/queries/use-user";
import CreateJobPageClient from "./_components/create-job-client";

/**
 * The route. Everything it shows is in CreateJobPageClient.
 *
 * This file used to hold its own 460-line copy of the form — an older one,
 * written before jobs belonged to a client company. It had no client company
 * field and never sent `clientCompanyId`, so every attempt to create a job
 * through the product failed: the column is NOT NULL, the request came back
 * 500, and nothing was shown to whoever pressed Save. The decomposed version
 * beside it had the field all along and was rendered by nobody.
 */
export default function CreateNewJobPage() {
  const router = useRouter();
  const { data: currentUserRes, isLoading } = useCurrentUser();
  const role = currentUserRes?.data?.role;
  const isManager = role === "super_admin" || role === "hiring_manager";

  useEffect(() => {
    if (role && !isManager) router.replace("/jobs");
  }, [role, isManager, router]);

  if (isLoading || !role || !isManager) return null;

  return <CreateJobPageClient />;
}

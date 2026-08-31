"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/queries/use-user";
import AddCandidateClient from "./_components/add-candidate-client";

/**
 * The route. Everything it shows is in AddCandidateClient.
 *
 * A page rather than a dialog, matching /jobs/new. Adding a candidate and
 * creating a job are the same kind of act — a form with a few fields and a
 * file — and doing one in a modal and the other on a page is two answers to
 * one question on adjacent screens.
 */
export default function AddCandidatePage() {
  const router = useRouter();
  const { data: currentUserRes, isLoading } = useCurrentUser();
  const role = currentUserRes?.data?.role;
  const isManager = role === "super_admin" || role === "hiring_manager";

  // The button is hidden from anyone else, but the URL is not.
  useEffect(() => {
    if (role && !isManager) router.replace("/candidates");
  }, [role, isManager, router]);

  if (isLoading || !role || !isManager) return null;

  return <AddCandidateClient />;
}

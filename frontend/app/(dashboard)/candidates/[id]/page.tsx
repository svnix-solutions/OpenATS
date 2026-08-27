"use client";

import { use } from "react";
import { CandidateDetail } from "./_components/candidate-detail";

/**
 * The route. Everything it shows lives in CandidateDetail, which the side
 * panel renders too — so the two cannot drift apart the way they had.
 */
export default function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <CandidateDetail candidateId={parseInt(id, 10)} />;
}

import { Queue } from "bullmq";
import { createRedisConnection } from "../../config/redis";
import { currentOrganizationId } from "../../db";

export const CANDIDATE_IMPORT_QUEUE = "candidate-import";

export type CandidateImportJobData = {
  /** The `candidate_imports` row holding the file and the progress. */
  importId: number;
  /**
   * The tenant. The worker has no request behind it, so nothing else can tell
   * it which organization to act for — carrying it on the job is the only
   * thing that survives the queue.
   */
  organizationId: number;
};

export const candidateImportQueue = new Queue<CandidateImportJobData>(
  CANDIDATE_IMPORT_QUEUE,
  {
    connection: createRedisConnection(),
    defaultJobOptions: {
      // One attempt. A retry would re-run rows that already landed — they
      // would come back as `already_on_job` rather than duplicating, but the
      // report would then describe the retry instead of the import, and a run
      // that died halfway is something a person should look at.
      attempts: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
    },
  },
);

export async function requestCandidateImport(importId: number): Promise<void> {
  const organizationId = currentOrganizationId();
  if (organizationId === null) {
    throw new Error("requestCandidateImport called with no organization context");
  }

  await candidateImportQueue.add("import", { importId, organizationId });
}

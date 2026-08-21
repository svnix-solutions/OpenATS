import { Queue } from "bullmq";
import { createRedisConnection } from "../../config/redis";
import { currentOrganizationId } from "../../db";
import { cvAnalysisService } from "../../modules/candidate/cv-analysis.service";
import logger from "../../utils/logger";

export const CV_ANALYSIS_QUEUE = "cv-analysis";

export type CvAnalysisJobData = {
  candidateId: number;
  jobId: number;
  resumeUrl: string;
  /**
   * The tenant this job belongs to.
   *
   * The worker runs in its own process with no request behind it, so nothing
   * else can tell it which organization to act for. Carrying it on the job is
   * the only thing that survives the queue.
   */
  organizationId: number;
};

export const cvAnalysisQueue = new Queue<CvAnalysisJobData>(CV_ANALYSIS_QUEUE, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export async function requestCvAnalysis(
  data: Omit<CvAnalysisJobData, "organizationId">,
): Promise<void> {
  const organizationId = currentOrganizationId();
  if (organizationId === null) {
    // Enqueuing outside a request would produce a job the worker cannot run.
    // Better to fail here, where there is a stack trace, than in a worker
    // that would only ever see an empty database.
    throw new Error("requestCvAnalysis called with no organization context");
  }

  await cvAnalysisService.markPending(data.candidateId, data.jobId);
  await cvAnalysisQueue.add("analyze", { ...data, organizationId });
  logger.info(
    `[cv-queue] enqueued analysis for candidate=${data.candidateId} job=${data.jobId}`,
  );
}

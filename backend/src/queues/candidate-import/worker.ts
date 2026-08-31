import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createRedisConnection } from "../../config/redis";
import { db, runInOrganization } from "../../db";
import { candidateImports } from "../../db/schema/imports";
import { importCandidates } from "../../modules/candidate/import.service";
import {
  CANDIDATE_IMPORT_QUEUE,
  type CandidateImportJobData,
} from "./queue";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * Runs an import outside the request that asked for it.
 *
 * Concurrency of one. Each row is an insert and a lookup, and several imports
 * at once would compete with the application for the same connections — a
 * background job is not worth making the dashboard slow for.
 */
export function startCandidateImportWorker() {
  return new Worker<CandidateImportJobData>(
    CANDIDATE_IMPORT_QUEUE,
    async (job) => {
      const { importId, organizationId } = job.data;

      await runInOrganization(organizationId, async () => {
        const [run] = await db
          .select()
          .from(candidateImports)
          .where(eq(candidateImports.id, importId))
          .limit(1);

        if (!run?.csv) {
          // Already finished, or the row is gone. Not an error: a retry or a
          // duplicate delivery lands here and there is nothing left to do.
          logger.info(`Candidate import ${importId} has nothing to process`);
          return;
        }

        await db
          .update(candidateImports)
          .set({ status: "running" })
          .where(eq(candidateImports.id, importId));

        try {
          const report = await importCandidates(run.jobId, run.csv, {
            dryRun: false,
            // Progress, so a screen can say where this is rather than
            // spinning. Written every twenty rows: often enough to move
            // visibly, rarely enough not to be an update per candidate.
            onProgress: async (processed, total) => {
              if (processed % 20 !== 0 && processed !== total) return;
              await db
                .update(candidateImports)
                .set({ processed, total })
                .where(eq(candidateImports.id, importId));
            },
          });

          await db
            .update(candidateImports)
            .set({
              status: "done",
              processed: report.rows.length,
              total: report.rows.length,
              counts: report.counts,
              problems: report.rows.filter(
                (r) => r.outcome !== "imported" && r.outcome !== "would_import",
              ),
              // The file has been read. It is a list of people's contact
              // details and keeping it now serves nothing.
              csv: null,
              finishedAt: new Date(),
            })
            .where(eq(candidateImports.id, importId));

          logger.info(
            `Candidate import ${importId} finished: ${JSON.stringify(report.counts)}`,
          );
        } catch (error) {
          const message = getErrorMessage(error);
          logger.error(`Candidate import ${importId} failed: ${message}`);
          await db
            .update(candidateImports)
            .set({
              status: "failed",
              error: message,
              csv: null,
              finishedAt: new Date(),
            })
            .where(eq(candidateImports.id, importId));
          throw error;
        }
      });
    },
    { connection: createRedisConnection(), concurrency: 1 },
  );
}

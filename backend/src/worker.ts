import "dotenv/config";
import { validateEnv } from "./config/env";
import { initSentry } from "./config/sentry";

validateEnv();

// Its own process, so its own init. Errors in a background job are exactly
// the ones nobody is watching a response for.
initSentry();

import { startCvAnalysisWorker } from "./queues/cv-analysis/worker";
import { assertTenancyIsEnforceable } from "./db";
import logger from "./utils/logger";

// The same check the server makes, for the same reason: this process writes
// analysis results into whichever organization the job names, and a role that
// row-level security does not apply to would write them anywhere.
let worker: ReturnType<typeof startCvAnalysisWorker>;

assertTenancyIsEnforceable()
  .then(() => {
    worker = startCvAnalysisWorker();
    logger.info("CV analysis worker process started");
  })
  .catch((err: unknown) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

async function shutdown(signal: string) {
  logger.info(`[worker] received ${signal}, shutting down gracefully...`);
  await worker?.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

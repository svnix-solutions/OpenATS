import "dotenv/config";
import { validateEnv } from "./config/env";
import { initSentry } from "./config/sentry";

validateEnv();

// Its own process, so its own init. Errors in a background job are exactly
// the ones nobody is watching a response for.
initSentry();

import { startCvAnalysisWorker } from "./queues/cv-analysis/worker";
import logger from "./utils/logger";

const worker = startCvAnalysisWorker();
logger.info("CV analysis worker process started");

async function shutdown(signal: string) {
  logger.info(`[worker] received ${signal}, shutting down gracefully...`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

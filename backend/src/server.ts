import "dotenv/config";
import http from "http";
import { validateEnv } from "./config/env";
import { initSentry } from "./config/sentry";

const env = validateEnv();

// Before ./app and everything it pulls in: the SDK instruments http and
// express by patching them as they load, so anything imported first is
// invisible to it. This is why these imports are not at the top of the file.
initSentry();

import app from "./app";
import { socketService } from "./shared/services/socket.service";
import { subscribeToCvAnalysisEvents } from "./queues/cv-analysis/events";
import { runInOrganization, assertTenancyIsEnforceable } from "./db";
import logger from "./utils/logger";

const PORT = env.PORT;

const server = http.createServer(app);

socketService.initialize(server);

// The one broadcast with no request behind it: the analysis finished in the
// worker process and arrives here over Redis. Re-enter the organization the
// event names so it reaches that tenant's dashboards and no others.
subscribeToCvAnalysisEvents((event) => {
  void runInOrganization(event.organizationId, async () => {
    socketService.emitCvAnalysisUpdate(event);
  });
});

// Before accepting a request, not after: a boundary that is not being
// enforced should stop the process, not serve one tenant's data to another
// while someone reads the logs.
assertTenancyIsEnforceable()
  .then(() => {
    server.listen(PORT, () => {
      logger.info(`OpenATS Backend running on port ${PORT}`);
      logger.info(`Socket.io initialized and listening on the same port.`);
    });
  })
  .catch((err: unknown) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

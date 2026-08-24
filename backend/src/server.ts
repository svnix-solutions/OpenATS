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
import logger from "./utils/logger";

const PORT = env.PORT;

const server = http.createServer(app);

socketService.initialize(server);

subscribeToCvAnalysisEvents((event) => {
  socketService.emitCvAnalysisUpdate(event);
});

server.listen(PORT, () => {
  logger.info(`OpenATS Backend running on port ${PORT}`);
  logger.info(`Socket.io initialized and listening on the same port.`);
});

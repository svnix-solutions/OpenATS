import "dotenv/config";
import { validateEnv } from "./config/env";
import { initSentry } from "./config/sentry";

// What this process actually touches: a database, Redis, and the key that
// decrypts a stored session. Not mail, not object storage, not the identity
// provider — its compose environment carries none of those on purpose, and
// validating the whole schema here would have meant handing it a Resend key
// and an R2 secret so that a check could pass.
validateEnv([
  "DATABASE_URL",
  "REDIS_URL",
  "ENCRYPTION_KEY",
]);
initSentry();

import { assertTenancyIsEnforceable } from "./db";
import { startTelegramBridge } from "./shared/messaging/telegram-bridge";
import logger from "./utils/logger";

/**
 * The Telegram connection, in a process of its own.
 *
 * MTProto is not a webhook. It is a connection that stays open and is handed
 * messages as they arrive, which means exactly one process may hold a given
 * session — two clients on the same session fight over the auth key and the
 * account ends up signed out of both.
 *
 * That rules out the API, which is free to run more than one replica, and it
 * rules out the queue worker, which BullMQ may also scale. Its own container
 * is the only shape where "exactly one" is something the deployment can
 * actually promise.
 *
 * Outbound goes through here too, over a queue, so the session lives in one
 * place rather than being decrypted wherever a send happens to be requested.
 */

let bridge: Awaited<ReturnType<typeof startTelegramBridge>> | undefined;

assertTenancyIsEnforceable()
  .then(async () => {
    bridge = await startTelegramBridge();
    logger.info("Telegram bridge process started");
  })
  .catch((err: unknown) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

async function shutdown(signal: string) {
  logger.info(`[telegram] received ${signal}, shutting down gracefully...`);
  // Disconnecting rather than exiting under it: a session dropped without a
  // clean close leaves Telegram holding the connection for a while, and the
  // next start of this container is refused as a duplicate.
  await bridge?.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

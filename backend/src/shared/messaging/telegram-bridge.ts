import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { NewMessage, type NewMessageEvent } from "teleproto/events";
import { and, eq } from "drizzle-orm";
import { db, runInOrganization, unscopedDb } from "../../db";
import { sql } from "drizzle-orm";
import {
  candidateChannels,
  candidateMessages,
} from "../../db/schema/messaging";
import { decrypt } from "../integrations/crypto";
import { markFailed } from "./connection.service";
import type { TelegramCredentials } from "./connection.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * Holds one Telegram connection per organization, and writes what arrives.
 *
 * One connection each, because a session belongs to an agency's account. The
 * loop that finds them reads across every organization, which is the one thing
 * row-level security will not do — so it uses the unscoped connection to learn
 * *which* organizations have a session, and then does all the actual work
 * inside `runInOrganization`. Learning the list is not reading tenant data;
 * writing a message is, and that half is scoped.
 */

type Live = { organizationId: number; client: TelegramClient };

/** How often a newly connected account is noticed without a restart. */
const RESCAN_MS = 60_000;

export async function startTelegramBridge() {
  const live = new Map<number, Live>();
  let stopped = false;

  async function connectOne(organizationId: number, credentialsEncrypted: string) {
    let credentials: TelegramCredentials;
    try {
      credentials = JSON.parse(decrypt(credentialsEncrypted)) as TelegramCredentials;
    } catch (error) {
      // A blob that will not decrypt is usually ENCRYPTION_KEY having changed.
      // Nothing here can fix it, and retrying every minute forever hides it.
      logger.error(
        `Telegram credentials for organization ${organizationId} could not be read: ${getErrorMessage(error)}`,
      );
      await runInOrganization(organizationId, () =>
        markFailed("telegram", "Stored credentials could not be decrypted"),
      );
      return;
    }

    const client = new TelegramClient(
      new StringSession(credentials.session),
      credentials.apiId,
      credentials.apiHash,
      { connectionRetries: 5 },
    );

    try {
      await client.connect();
    } catch (error) {
      const message = getErrorMessage(error);
      logger.error(
        `Telegram connection failed for organization ${organizationId}: ${message}`,
      );
      // A revoked or banned session fails here and will fail forever. Marking
      // it inactive is what puts the reason on the Settings screen instead of
      // leaving every message queued behind it.
      if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED|BANNED/i.test(message)) {
        await runInOrganization(organizationId, () =>
          markFailed("telegram", message),
        );
      }
      return;
    }

    client.addEventHandler(
      (event: NewMessageEvent) => {
        void store(organizationId, event).catch((error: unknown) => {
          logger.error(
            `Failed to store an inbound Telegram message: ${getErrorMessage(error)}`,
          );
        });
      },
      new NewMessage({ incoming: true }),
    );

    live.set(organizationId, { organizationId, client });
    logger.info(`Telegram connected for organization ${organizationId}`);
  }

  async function scan() {
    if (stopped) return;

    // Which organizations have an active session — ids only, no tenant data.
    // The application role cannot see across organizations through the policy,
    // and this is the one question that legitimately spans them.
    const rows = await unscopedDb.execute<{
      organization_id: number;
      credentials_encrypted: string;
    }>(
      sql`SELECT organization_id, credentials_encrypted
          FROM messaging_connections
          WHERE channel = 'telegram' AND is_active`,
    );

    const wanted = new Set(rows.rows.map((r) => r.organization_id));

    // Gone, or deactivated since the last pass.
    for (const [organizationId, entry] of live) {
      if (wanted.has(organizationId)) continue;
      live.delete(organizationId);
      await entry.client.disconnect().catch(() => undefined);
      logger.info(`Telegram disconnected for organization ${organizationId}`);
    }

    for (const row of rows.rows) {
      if (live.has(row.organization_id)) continue;
      await connectOne(row.organization_id, row.credentials_encrypted);
    }
  }

  await scan();
  const timer = setInterval(() => void scan(), RESCAN_MS);

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await Promise.all(
        [...live.values()].map((e) => e.client.disconnect().catch(() => undefined)),
      );
      live.clear();
    },
    /** For tests and for the health of the process. */
    connectedOrganizations: () => [...live.keys()],
  };
}

/**
 * Records an inbound message against the candidate it came from.
 *
 * Inside `runInOrganization`, so every statement is filtered by the policy —
 * this process holds connections for every tenant at once, and that is exactly
 * the situation where an unscoped write goes to the wrong one.
 */
async function store(
  organizationId: number,
  event: NewMessageEvent,
): Promise<void> {
  const message = event.message;
  const text = message.message;
  if (!text) return;

  const senderId = message.senderId?.toString();
  if (!senderId) return;

  await runInOrganization(organizationId, async () => {
    const [link] = await db
      .select({ candidateId: candidateChannels.candidateId })
      .from(candidateChannels)
      .where(
        and(
          eq(candidateChannels.channel, "telegram"),
          eq(candidateChannels.externalId, senderId),
        ),
      )
      .limit(1);

    // Same rule as the WhatsApp webhook: a message from someone no candidate
    // is linked to is dropped, not used to invent a person. This account is a
    // real Telegram account and will receive messages from anyone who finds
    // it, including spam.
    if (!link) return;

    await db
      .insert(candidateMessages)
      .values({
        candidateId: link.candidateId,
        channel: "telegram",
        direction: "inbound",
        body: text,
        externalId: message.id.toString(),
        sentAt: new Date(message.date * 1000),
      })
      .onConflictDoNothing({
        target: [
          candidateMessages.organizationId,
          candidateMessages.channel,
          candidateMessages.externalId,
        ],
      });
  });
}

import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { messagingConnections } from "../../db/schema/messaging";
import { decrypt, encrypt } from "../integrations/crypto";
import type { MessagingChannelId } from "./types";

/**
 * The agency's credentials for a channel.
 *
 * Every read here goes through the row-level policy, so none of these queries
 * names an organization and none of them can return another one's account.
 * That matters more than usual: the thing being returned is a WhatsApp access
 * token or a Telegram session, and a Telegram session is the account.
 */

/** What each channel needs, kept as one encrypted blob. */
export type WhatsAppCredentials = {
  channel: "whatsapp";
  /** The number messages are sent from, as Meta identifies it. */
  phoneNumberId: string;
  accessToken: string;
  /** Chosen by us and given to Meta, to prove a webhook GET is ours. */
  webhookVerifyToken: string;
  /** Signs every webhook POST; without it any stranger can post one. */
  appSecret: string;
  /**
   * The WhatsApp Business Account the number belongs to.
   *
   * Only needed to list approved templates, which is a different Graph node
   * from the phone number. Optional so a connection made before templates
   * existed keeps working — without it the template picker says what is
   * missing rather than showing an empty list.
   */
  businessAccountId?: string;
};

export type TelegramCredentials = {
  channel: "telegram";
  apiId: number;
  apiHash: string;
  /**
   * A logged-in MTProto session. Equivalent to the account's password: it
   * cannot be scoped, expires only when revoked, and anyone holding it is the
   * account. Never logged, never returned to a browser.
   */
  session: string;
};

export type ChannelCredentials = WhatsAppCredentials | TelegramCredentials;

export async function saveConnection(
  channel: MessagingChannelId,
  credentials: ChannelCredentials,
  accountLabel: string,
  connectedBy: number,
): Promise<void> {
  const credentialsEncrypted = encrypt(JSON.stringify(credentials));

  await db
    .insert(messagingConnections)
    .values({ channel, credentialsEncrypted, accountLabel, connectedBy })
    .onConflictDoUpdate({
      // The organization is in the constraint, not in this list, because the
      // policy already scopes the row — but the index it matches is on both,
      // so both are named. A conflict target that does not match an existing
      // unique index is rejected at plan time.
      target: [
        messagingConnections.organizationId,
        messagingConnections.channel,
      ],
      set: {
        credentialsEncrypted,
        accountLabel,
        connectedBy,
        isActive: true,
        // Reconnecting is how someone fixes a channel, so the old failure must
        // not survive it and keep the screen red.
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

/** The stored credentials, decrypted. Never hand the result to a client. */
export async function getCredentials(
  channel: MessagingChannelId,
): Promise<ChannelCredentials | null> {
  const [row] = await db
    .select({ credentialsEncrypted: messagingConnections.credentialsEncrypted })
    .from(messagingConnections)
    .where(
      and(
        eq(messagingConnections.channel, channel),
        eq(messagingConnections.isActive, true),
      ),
    )
    .limit(1);

  if (!row) return null;
  return JSON.parse(decrypt(row.credentialsEncrypted)) as ChannelCredentials;
}

/**
 * What Settings may see: which channels are connected, and as whom. Never the
 * credentials — this is the shape that reaches a browser.
 */
export async function listConnections() {
  return db
    .select({
      channel: messagingConnections.channel,
      accountLabel: messagingConnections.accountLabel,
      isActive: messagingConnections.isActive,
      lastError: messagingConnections.lastError,
      connectedAt: messagingConnections.createdAt,
    })
    .from(messagingConnections);
}

/**
 * Records why a channel stopped working, and takes it out of use.
 *
 * Both together, deliberately. A Telegram session that has been revoked — or
 * banned — fails every send from then on, and leaving it active means every
 * message queues behind something that will never succeed.
 */
export async function markFailed(
  channel: MessagingChannelId,
  reason: string,
): Promise<void> {
  await db
    .update(messagingConnections)
    .set({ isActive: false, lastError: reason, updatedAt: new Date() })
    .where(eq(messagingConnections.channel, channel));
}

export async function disconnect(
  channel: MessagingChannelId,
): Promise<void> {
  await db
    .delete(messagingConnections)
    .where(eq(messagingConnections.channel, channel));
}

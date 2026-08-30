import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  candidateChannels,
  candidateMessages,
} from "../../db/schema/messaging";
import { applications } from "../../db/schema/candidates";
import {
  getCredentials,
  markFailed,
} from "../../shared/messaging/connection.service";
import { whatsappProvider } from "../../shared/messaging/whatsapp.provider";
import {
  OutsideMessagingWindowError,
  type MessagingChannelId,
} from "../../shared/messaging/types";
import { requestTelegramSend } from "../../queues/telegram-send/queue";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * Conversations with a candidate.
 *
 * Keyed on the person, not the application. Someone who applied to two jobs is
 * one WhatsApp thread — they have one phone and one memory of talking to you.
 * Every parameter here is therefore `candidateId`, and the routes are what
 * translate from the application id the dashboard actually holds.
 */

/**
 * How long WhatsApp will carry free-form text after the candidate's own last
 * message. Meta's number, not ours.
 */
const FREE_FORM_WINDOW_MS = 24 * 60 * 60 * 1000;

export class NoChannelError extends Error {
  constructor(channel: MessagingChannelId) {
    super(`This candidate has no ${channel} conversation`);
    this.name = "NoChannelError";
  }
}

export class ChannelNotConnectedError extends Error {
  constructor(channel: MessagingChannelId) {
    super(`${channel} is not connected for this organization`);
    this.name = "ChannelNotConnectedError";
  }
}

export class OptedOutError extends Error {
  constructor() {
    super("This candidate has asked not to be messaged on this channel");
    this.name = "OptedOutError";
  }
}

export const messagingService = {
  /** The thread, oldest first, which is the order it is read in. */
  async getThread(candidateId: number) {
    return db
      .select({
        id: candidateMessages.id,
        channel: candidateMessages.channel,
        direction: candidateMessages.direction,
        body: candidateMessages.body,
        sentBy: candidateMessages.sentBy,
        delivery: candidateMessages.delivery,
        failureReason: candidateMessages.failureReason,
        sentAt: candidateMessages.sentAt,
      })
      .from(candidateMessages)
      .where(eq(candidateMessages.candidateId, candidateId))
      .orderBy(candidateMessages.sentAt, candidateMessages.id);
  },

  /** Which channels this person can be reached on, and whether they are open. */
  async getChannels(candidateId: number) {
    const channels = await db
      .select()
      .from(candidateChannels)
      .where(eq(candidateChannels.candidateId, candidateId));

    return Promise.all(
      channels.map(async (c) => ({
        channel: c.channel,
        externalId: c.externalId,
        displayName: c.displayName,
        optedInAt: c.optedInAt,
        optedOutAt: c.optedOutAt,
        freeFormOpenUntil: await freeFormOpenUntil(candidateId, c.channel),
      })),
    );
  },

  /**
   * Sends, and records what was sent.
   *
   * Refuses rather than guesses when the channel will not carry free-form
   * text. WhatsApp allows it only inside the window the candidate's own last
   * message opens; outside it, the only thing that goes through is a template
   * Meta approved in advance, which is a different request with different
   * content. Answering "sent" for something that was not is worse than an
   * error, because the recruiter moves on.
   */
  async send(
    candidateId: number,
    channel: MessagingChannelId,
    body: string,
    sentBy: number,
  ) {
    const [link] = await db
      .select()
      .from(candidateChannels)
      .where(
        and(
          eq(candidateChannels.candidateId, candidateId),
          eq(candidateChannels.channel, channel),
        ),
      )
      .limit(1);

    if (!link) throw new NoChannelError(channel);
    if (link.optedOutAt) throw new OptedOutError();

    const credentials = await getCredentials(channel);
    if (!credentials) throw new ChannelNotConnectedError(channel);

    // Telegram goes out through the bridge, which is the only process holding
    // the session. The row is written first, as `queued`, so the message
    // appears in the thread the moment it is sent rather than when Telegram
    // acknowledges it — and so a send that fails has somewhere to record why.
    //
    // No window check: Telegram has none. That asymmetry is the channel's, not
    // an oversight.
    if (channel === "telegram") {
      const [queued] = await db
        .insert(candidateMessages)
        .values({
          candidateId,
          channel,
          direction: "outbound",
          body,
          sentBy,
          delivery: "queued",
        })
        .returning();

      if (!queued) throw new Error("Could not record the message");

      await requestTelegramSend({
        messageId: queued.id,
        peerId: link.externalId,
        body,
      });

      return queued;
    }

    const openUntil = await freeFormOpenUntil(candidateId, channel);
    if (!openUntil) throw new OutsideMessagingWindowError(channel);

    let externalId: string;
    try {
      const result = await whatsappProvider.send(
        JSON.stringify(credentials),
        link.externalId,
        body,
      );
      externalId = result.externalId;
    } catch (error) {
      if (error instanceof OutsideMessagingWindowError) throw error;

      // The provider refusing our credentials is not this message's problem,
      // it is the channel's — and leaving it active means every later send
      // queues behind something that will never succeed.
      const message = getErrorMessage(error);
      if (/token|auth|permission|OAuth/i.test(message)) {
        await markFailed(channel, message);
      }
      logger.error(`Failed to send ${channel} message: ${message}`);
      throw error;
    }

    const [stored] = await db
      .insert(candidateMessages)
      .values({
        candidateId,
        channel,
        direction: "outbound",
        body,
        sentBy,
        externalId,
      })
      .returning();

    return stored ?? null;
  },
};

/**
 * When the free-form window closes, or null if it is already shut.
 *
 * Measured from the candidate's own last message, because that is what opens
 * it. Our own outbound messages do not — a business cannot hold a window open
 * by talking to itself, and treating them as if it could would produce a
 * screen that says a message can be sent right up until it is refused.
 */
async function freeFormOpenUntil(
  candidateId: number,
  channel: MessagingChannelId,
): Promise<Date | null> {
  const [last] = await db
    .select({ sentAt: candidateMessages.sentAt })
    .from(candidateMessages)
    .where(
      and(
        eq(candidateMessages.candidateId, candidateId),
        eq(candidateMessages.channel, channel),
        eq(candidateMessages.direction, "inbound"),
      ),
    )
    .orderBy(desc(candidateMessages.sentAt))
    .limit(1);

  if (!last) return null;

  const closesAt = new Date(last.sentAt.getTime() + FREE_FORM_WINDOW_MS);
  return closesAt > new Date() ? closesAt : null;
}

/** The person behind an application id, which is what routes are given. */
export async function personForApplication(
  applicationId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ candidateId: applications.candidateId })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);

  return row?.candidateId ?? null;
}

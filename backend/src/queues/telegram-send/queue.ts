import { Queue } from "bullmq";
import { createRedisConnection } from "../../config/redis";
import { currentOrganizationId } from "../../db";

export const TELEGRAM_SEND_QUEUE = "telegram-send";

/**
 * Two jobs, one queue, deliberately.
 *
 * They share the worker's concurrency of one, which is what protects the
 * account: Telegram rate-limits sending *and* contact lookups, and separate
 * queues would let the two race each other into a flood wait together.
 */
export type TelegramJobName = "send" | "resolve";

export type TelegramResolveJobData = {
  /** The person to link, once Telegram says who this number is. */
  candidateId: number;
  /** E.164 digits, the same normalisation the WhatsApp address uses. */
  phone: string;
  displayName: string;
  organizationId: number;
};

export type TelegramSendJobData = {
  /**
   * The row already written as `queued`. The bridge updates it rather than
   * inserting, so a message appears in the thread the moment a recruiter
   * presses send and then changes state, instead of appearing only once
   * Telegram has acknowledged it.
   */
  messageId: number;
  /** Telegram's id for the recipient, from `candidate_channels`. */
  peerId: string;
  body: string;
  /**
   * The tenant. The bridge has no request behind it, so nothing else can tell
   * it which organization to act for — carrying it on the job is the only
   * thing that survives the queue.
   */
  organizationId: number;
};

export type TelegramJobData = TelegramSendJobData | TelegramResolveJobData;

export const telegramSendQueue = new Queue<TelegramJobData>(
  TELEGRAM_SEND_QUEUE,
  {
    connection: createRedisConnection(),
    defaultJobOptions: {
      // Fewer attempts than CV analysis, and slower. A retry here re-sends to
      // a person; a duplicate message is worse than a late one, and Telegram's
      // own flood limits punish exactly this.
      attempts: 3,
      backoff: { type: "exponential", delay: 15_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  },
);

/**
 * Asks the bridge who this number is on Telegram, and links them.
 *
 * On demand, one candidate at a time — never swept over everyone who applied.
 * Importing contacts in bulk is precisely the pattern Telegram limits accounts
 * for, and the account it would cost is the agency's own.
 */
export async function requestTelegramResolve(
  data: Omit<TelegramResolveJobData, "organizationId">,
): Promise<void> {
  const organizationId = currentOrganizationId();
  if (organizationId === null) {
    throw new Error("requestTelegramResolve called with no organization context");
  }

  await telegramSendQueue.add("resolve", { ...data, organizationId });
}

export async function requestTelegramSend(
  data: Omit<TelegramSendJobData, "organizationId">,
): Promise<void> {
  const organizationId = currentOrganizationId();
  if (organizationId === null) {
    throw new Error("requestTelegramSend called with no organization context");
  }

  await telegramSendQueue.add("send", { ...data, organizationId } as TelegramSendJobData);
}

import { Queue } from "bullmq";
import { createRedisConnection } from "../../config/redis";
import { currentOrganizationId } from "../../db";

export const TELEGRAM_SEND_QUEUE = "telegram-send";

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

export const telegramSendQueue = new Queue<TelegramSendJobData>(
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

export async function requestTelegramSend(
  data: Omit<TelegramSendJobData, "organizationId">,
): Promise<void> {
  const organizationId = currentOrganizationId();
  if (organizationId === null) {
    throw new Error("requestTelegramSend called with no organization context");
  }

  await telegramSendQueue.add("send", { ...data, organizationId });
}

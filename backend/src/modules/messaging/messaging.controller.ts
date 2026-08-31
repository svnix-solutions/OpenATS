import type { Request, Response } from "express";
import { z } from "zod";
import { canReadPerson } from "../../shared/auth/job-access";
import { OutsideMessagingWindowError } from "../../shared/messaging/types";
import {
  ChannelNotConnectedError,
  NoChannelError,
  OptedOutError,
  messagingService,
  personForApplication,
} from "./messaging.service";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { candidates } from "../../db/schema/candidates";
import { candidateChannels } from "../../db/schema/messaging";
import { toChannelAddress } from "../../shared/messaging/address";
import { requestTelegramResolve } from "../../queues/telegram-send/queue";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * The candidate's conversation.
 *
 * `:id` here is an application id, like everywhere else in the dashboard —
 * that is what the list links to. Messages hang off the person, so every
 * handler translates once, up front, and the parameter is named for what it
 * actually holds. The one place that called an application id `candidateId`
 * was an offer written against the wrong person.
 */

const sendSchema = z.object({
  channel: z.enum(["whatsapp", "telegram"]),
  body: z.string().trim().min(1, "A message cannot be empty").max(4000),
});

/** Resolves the person and checks the caller may see them, or answers. */
async function resolvePerson(
  req: Request,
  res: Response,
): Promise<number | null> {
  const applicationId = Number(req.params.id);
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    res.status(404).json({ error: "Not found" });
    return null;
  }

  const candidateId = await personForApplication(applicationId);
  // The same 404 for "no such application" and "not yours": telling them
  // apart is how someone maps out ids they cannot read.
  if (candidateId === null || !req.user) {
    res.status(404).json({ error: "Not found" });
    return null;
  }

  if (!(await canReadPerson(req.user, candidateId))) {
    res.status(404).json({ error: "Not found" });
    return null;
  }

  return candidateId;
}

export const getConversation = async (req: Request, res: Response) => {
  try {
    const candidateId = await resolvePerson(req, res);
    if (candidateId === null) return;

    const [messages, channels] = await Promise.all([
      messagingService.getThread(candidateId),
      messagingService.getChannels(candidateId),
    ]);

    return res.status(200).json({ data: { messages, channels } });
  } catch (error) {
    logger.error(`Failed to read conversation: ${getErrorMessage(error)}`);
    return res.status(500).json({ error: "Failed to read the conversation" });
  }
};

/**
 * Asks Telegram who this candidate's number belongs to, and links them.
 *
 * A recruiter's deliberate action on one candidate, never a sweep over
 * everyone who applied: importing contacts in bulk is the pattern Telegram
 * limits accounts over, and the account it would cost is the agency's own.
 *
 * Answers immediately. The lookup happens in the bridge, which is the only
 * process holding a session, so the honest answer here is "asked", not
 * "found".
 */
export const findOnTelegram = async (req: Request, res: Response) => {
  try {
    const candidateId = await resolvePerson(req, res);
    if (candidateId === null) return;

    const [person] = await db
      .select({
        phone: candidates.phone,
        firstName: candidates.firstName,
        lastName: candidates.lastName,
      })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1);

    const phone = toChannelAddress(person?.phone);
    if (!phone) {
      return res.status(409).json({
        error:
          "This candidate has no phone number in international format, so Telegram cannot be asked about them.",
        code: "no_phone",
      });
    }

    // Consent travels with the person, not the channel. Someone who did not
    // agree to be messaged is not looked up on a second network either.
    const [consent] = await db
      .select({ optedOutAt: candidateChannels.optedOutAt })
      .from(candidateChannels)
      .where(eq(candidateChannels.candidateId, candidateId))
      .limit(1);

    if (!consent) {
      return res.status(409).json({
        error: "This candidate has not agreed to be messaged.",
        code: "no_consent",
      });
    }
    if (consent.optedOutAt) {
      return res
        .status(409)
        .json({ error: "This candidate has opted out.", code: "opted_out" });
    }

    await requestTelegramResolve({
      candidateId,
      phone,
      displayName: `${person!.firstName} ${person!.lastName}`.trim(),
    });

    return res.status(202).json({ data: { status: "asked" } });
  } catch (error) {
    logger.error(`Failed to look a candidate up on Telegram: ${getErrorMessage(error)}`);
    return res.status(500).json({ error: "Could not ask Telegram" });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const candidateId = await resolvePerson(req, res);
    if (candidateId === null) return;

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    }

    const message = await messagingService.send(
      candidateId,
      parsed.data.channel,
      parsed.data.body,
      req.user!.id,
    );

    return res.status(201).json({ data: message });
  } catch (error) {
    // A closed window is not a server fault and not the sender's mistake —
    // it is a fact about the channel that the screen has to explain, so it
    // gets its own status and a code the UI can branch on rather than a
    // message it would have to match against.
    if (error instanceof OutsideMessagingWindowError) {
      return res.status(409).json({
        error:
          "This candidate has not messaged in the last 24 hours, so WhatsApp will only carry an approved template.",
        code: "outside_messaging_window",
      });
    }
    if (error instanceof OptedOutError) {
      return res.status(409).json({ error: error.message, code: "opted_out" });
    }
    if (error instanceof NoChannelError) {
      return res.status(409).json({ error: error.message, code: "no_channel" });
    }
    if (error instanceof ChannelNotConnectedError) {
      return res
        .status(409)
        .json({ error: error.message, code: "channel_not_connected" });
    }

    logger.error(`Failed to send message: ${getErrorMessage(error)}`);
    return res.status(502).json({ error: "The channel refused the message" });
  }
};

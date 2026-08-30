import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { candidateChannels, candidateMessages } from "../../db/schema/messaging";
import { getCredentials } from "../../shared/messaging/connection.service";
import { whatsappProvider } from "../../shared/messaging/whatsapp.provider";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * Inbound WhatsApp.
 *
 * `withPublicOrganization("messaging_webhook", "token")` has already run, so
 * these handlers are inside the right organization and every query below is
 * filtered by the policy. The token in the URL got them there; it is not what
 * makes the request trustworthy.
 *
 * That is the signature, checked here before a single row is written. Without
 * it this endpoint is a way for anyone who has seen the URL to put words in a
 * candidate's mouth, in a system people make hiring decisions from.
 */

/**
 * Meta's verification handshake, which happens once when the webhook is
 * configured. It is a GET with no body and no signature — nothing to verify
 * except that the caller knows the token we gave them.
 */
export const verifyWhatsappWebhook = async (req: Request, res: Response) => {
  try {
    const credentials = await getCredentials("whatsapp");
    if (!credentials || credentials.channel !== "whatsapp") {
      return res.status(404).send("Not found");
    }

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode !== "subscribe" || token !== credentials.webhookVerifyToken) {
      // 403 rather than 404: the operator is looking at this response in
      // Meta's configuration screen, and "wrong verify token" is the thing
      // they need to be told.
      return res.status(403).send("Forbidden");
    }

    // Echoed verbatim, as plain text. Meta compares the body byte for byte.
    return res.status(200).send(String(challenge ?? ""));
  } catch (error) {
    logger.error(`WhatsApp webhook verification failed: ${getErrorMessage(error)}`);
    return res.status(500).send("Error");
  }
};

export const receiveWhatsappWebhook = async (req: Request, res: Response) => {
  try {
    const credentials = await getCredentials("whatsapp");
    if (!credentials || credentials.channel !== "whatsapp") {
      return res.status(404).json({ error: "Not found" });
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      logger.error("WhatsApp webhook received without a raw body to verify");
      return res.status(400).json({ error: "Bad request" });
    }

    const ok = whatsappProvider.verifyWebhook(
      rawBody,
      req.headers as Record<string, string | undefined>,
      JSON.stringify(credentials),
    );
    if (!ok) {
      logger.warn("WhatsApp webhook rejected: signature did not verify");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const messages = whatsappProvider.parseInbound(req.body);

    for (const message of messages) {
      // Only a candidate this organization already has a channel for. A
      // message from a number nobody recognises is dropped rather than
      // creating a person: an inbound WhatsApp is an unauthenticated claim
      // about who is writing, and a pipeline is not a place to invent people.
      const [channel] = await db
        .select({ candidateId: candidateChannels.candidateId })
        .from(candidateChannels)
        .where(
          and(
            eq(candidateChannels.channel, "whatsapp"),
            eq(candidateChannels.externalId, message.from),
          ),
        )
        .limit(1);

      if (!channel) {
        logger.info(
          `WhatsApp message from an address no candidate is linked to; dropped`,
        );
        continue;
      }

      await db
        .insert(candidateMessages)
        .values({
          candidateId: channel.candidateId,
          channel: "whatsapp",
          direction: "inbound",
          body: message.body,
          externalId: message.externalId,
          sentAt: message.sentAt,
        })
        // Delivery is at least once: Meta resends anything it did not get a
        // 200 for, so the same message arrives again after a timeout. Without
        // this the thread grows a duplicate every time that happens.
        .onConflictDoNothing({
          target: [
            candidateMessages.organizationId,
            candidateMessages.channel,
            candidateMessages.externalId,
          ],
        });
    }

    // 200 even when nothing was stored. Meta retries anything else, and there
    // is nothing to gain from being sent a message we have already decided to
    // drop.
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`WhatsApp webhook failed: ${getErrorMessage(error)}`);
    // Deliberately a 500: this one Meta should retry, because the message is
    // real and we failed to store it.
    return res.status(500).json({ error: "Failed to process" });
  }
};

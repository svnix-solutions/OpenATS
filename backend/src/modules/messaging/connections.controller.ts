import { randomBytes } from "crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { messagingConnections } from "../../db/schema/messaging";
import {
  disconnect,
  listConnections,
  saveConnection,
} from "../../shared/messaging/connection.service";
import { whatsappProvider } from "../../shared/messaging/whatsapp.provider";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * Connecting the agency's messaging channels.
 *
 * Organization-wide, so this is administrators only — connecting a channel
 * decides which number every candidate conversation comes from, and
 * disconnecting one silently ends every thread on it.
 */

const whatsappSchema = z.object({
  channel: z.literal("whatsapp"),
  phoneNumberId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  appSecret: z.string().trim().min(1),
});

export const getMessagingConnections = async (_req: Request, res: Response) => {
  try {
    const rows = await listConnections();

    // The webhook URL is assembled here rather than stored, so it follows the
    // deployment rather than being frozen at whatever the address was on the
    // day someone connected.
    const [tokens] = await Promise.all([
      db
        .select({
          channel: messagingConnections.channel,
          webhookToken: messagingConnections.webhookToken,
        })
        .from(messagingConnections),
    ]);
    const byChannel = new Map(tokens.map((t) => [t.channel, t.webhookToken]));

    return res.status(200).json({
      data: rows.map((row) => ({
        ...row,
        webhookUrl:
          byChannel.get(row.channel) && apiBase()
            ? `${apiBase()}/public/webhooks/${row.channel}/${byChannel.get(row.channel)}`
            : null,
      })),
    });
  } catch (error) {
    logger.error(`Failed to list messaging connections: ${getErrorMessage(error)}`);
    return res.status(500).json({ error: "Failed to load connections" });
  }
};

export const connectWhatsapp = async (req: Request, res: Response) => {
  try {
    const parsed = whatsappSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    }

    // Generated here, not supplied. It has to be unguessable, and asking a
    // person to invent one is asking for "whatsapp".
    const webhookVerifyToken = randomBytes(16).toString("hex");
    const webhookToken = randomBytes(24).toString("hex");

    const credentials = {
      channel: "whatsapp" as const,
      phoneNumberId: parsed.data.phoneNumberId,
      accessToken: parsed.data.accessToken,
      appSecret: parsed.data.appSecret,
      webhookVerifyToken,
    };

    // Checked against Meta before anything is stored, so a typo is an error
    // here rather than a channel that looks connected and silently never
    // delivers.
    let accountLabel: string;
    try {
      ({ accountLabel } = await whatsappProvider.describe(
        JSON.stringify(credentials),
      ));
    } catch (error) {
      return res.status(400).json({
        error: `WhatsApp refused these credentials: ${getErrorMessage(error)}`,
      });
    }

    await saveConnection("whatsapp", credentials, accountLabel, req.user!.id);
    await db
      .update(messagingConnections)
      .set({ webhookToken })
      .where(eq(messagingConnections.channel, "whatsapp"));

    // Returned once, because the operator has to paste both into Meta's
    // configuration screen. The verify token is not readable again afterwards
    // — reconnecting issues a new one.
    return res.status(201).json({
      data: {
        accountLabel,
        webhookUrl: apiBase()
          ? `${apiBase()}/public/webhooks/whatsapp/${webhookToken}`
          : null,
        webhookVerifyToken,
      },
    });
  } catch (error) {
    logger.error(`Failed to connect WhatsApp: ${getErrorMessage(error)}`);
    return res.status(500).json({ error: "Failed to connect WhatsApp" });
  }
};

export const disconnectChannel = async (req: Request, res: Response) => {
  try {
    const channel = req.params.channel;
    if (channel !== "whatsapp" && channel !== "telegram") {
      return res.status(404).json({ error: "Not found" });
    }

    await disconnect(channel);
    return res.status(204).send();
  } catch (error) {
    logger.error(`Failed to disconnect channel: ${getErrorMessage(error)}`);
    return res.status(500).json({ error: "Failed to disconnect" });
  }
};

/**
 * Where a provider reaches this API from outside.
 *
 * Not FRONTEND_URL: webhooks are posted to the backend directly, and the two
 * are different hostnames in every deployment that puts a proxy in front.
 */
function apiBase(): string {
  const configured = process.env.PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  // No fallback. A guessed origin produces a URL that is pasted into Meta's
  // configuration screen and silently never delivers, which is discovered
  // weeks later by a candidate who thinks they were ignored. Saying "not
  // configured" is the honest answer.
  logger.warn(
    "PUBLIC_API_URL is not set, so the webhook URL cannot be shown to operators",
  );
  return "";
}

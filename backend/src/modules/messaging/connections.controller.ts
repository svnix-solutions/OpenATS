import { randomBytes } from "crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentOrganizationId, db } from "../../db";
import { messagingConnections } from "../../db/schema/messaging";
import {
  disconnect,
  listConnections,
  saveConnection,
} from "../../shared/messaging/connection.service";
import { whatsappProvider } from "../../shared/messaging/whatsapp.provider";
import {
  completeLogin,
  NoPendingLoginError,
  startLogin,
} from "../../shared/messaging/telegram-login.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * Connecting the agency's messaging channels.
 *
 * Organization-wide, so this is administrators only — connecting a channel
 * decides which number every candidate conversation comes from, and
 * disconnecting one silently ends every thread on it.
 */

const telegramStartSchema = z.object({
  // From my.telegram.org. Not secrets in the usual sense — they identify the
  // application, not the account — but they are what the session is bound to,
  // so they are stored with it rather than in the environment.
  apiId: z.coerce.number().int().positive(),
  apiHash: z.string().trim().min(8),
  phoneNumber: z.string().trim().regex(/^\+[0-9]{6,20}$/, "Use international format, e.g. +49301234567"),
});

const telegramVerifySchema = z.object({
  code: z.string().trim().min(3).max(16),
  /** Only after Telegram has said the account has two-step verification. */
  password: z.string().min(1).optional(),
});

const whatsappSchema = z.object({
  channel: z.literal("whatsapp"),
  phoneNumberId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  appSecret: z.string().trim().min(1),
  // Optional: it is only needed to list templates, and a connection made
  // without one still sends and receives.
  businessAccountId: z.string().trim().min(1).optional(),
});

/**
 * The api_id and api_hash between the two steps of a login.
 *
 * Held here rather than sent again with the code, so a browser does not carry
 * them twice. Keyed by organization for the same reason the pending client is:
 * process-local state in a multi-tenant application is shared by every tenant
 * unless its key says otherwise.
 */
const pendingCredentials = new Map<number, { apiId: number; apiHash: string }>();

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
      ...(parsed.data.businessAccountId && {
        businessAccountId: parsed.data.businessAccountId,
      }),
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

/**
 * Step one: ask Telegram to send a login code.
 *
 * The code arrives in the Telegram app on that account, not by SMS, whenever
 * the account is signed in somewhere already. People wait for a text that
 * never comes, so the screen says so.
 */
export const startTelegramLogin = async (req: Request, res: Response) => {
  try {
    const parsed = telegramStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    }

    pendingCredentials.set(currentOrganizationId()!, {
      apiId: parsed.data.apiId,
      apiHash: parsed.data.apiHash,
    });

    await startLogin(parsed.data.apiId, parsed.data.apiHash, parsed.data.phoneNumber);
    return res.status(200).json({ data: { status: "code_sent" } });
  } catch (error) {
    const message = getErrorMessage(error);
    logger.error(`Telegram login could not be started: ${message}`);
    // Telegram's own message is the useful one here — a wrong api_hash, a
    // number it refuses, a flood wait with the seconds in it.
    return res.status(400).json({ error: message });
  }
};

/**
 * Step two: the code, and the password if there is one.
 *
 * "Needs password" is a normal answer, not a failure: Telegram only says an
 * account has two-step verification after the code has been accepted, so it
 * cannot be asked for up front.
 */
export const verifyTelegramLogin = async (req: Request, res: Response) => {
  try {
    const parsed = telegramVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    }

    const result = await completeLogin(parsed.data.code, parsed.data.password);
    if (result.status === "needs_password") {
      return res.status(200).json({ data: { status: "needs_password" } });
    }

    const orgId = currentOrganizationId()!;
    const creds = pendingCredentials.get(orgId);
    if (!creds) {
      return res.status(409).json({
        error: "That login expired. Start again.",
        code: "no_pending_login",
      });
    }
    pendingCredentials.delete(orgId);

    await saveConnection(
      "telegram",
      { channel: "telegram", ...creds, session: result.session },
      result.accountLabel,
      req.user!.id,
    );

    // The bridge notices on its next scan; it is not started from here,
    // because it lives in another container by design.
    return res.status(201).json({
      data: { status: "connected", accountLabel: result.accountLabel },
    });
  } catch (error) {
    if (error instanceof NoPendingLoginError) {
      return res
        .status(409)
        .json({ error: error.message, code: "no_pending_login" });
    }
    const message = getErrorMessage(error);
    logger.error(`Telegram login could not be completed: ${message}`);
    return res.status(400).json({ error: message });
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

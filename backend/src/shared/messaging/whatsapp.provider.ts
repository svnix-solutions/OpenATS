import { createHmac, timingSafeEqual } from "crypto";
import type {
  InboundMessage,
  OutboundResult,
  WebhookChannelClient,
} from "./types";
import { OutsideMessagingWindowError } from "./types";
import type { WhatsAppCredentials } from "./connection.service";

/**
 * WhatsApp, through Meta's Cloud API.
 *
 * The rule that shapes everything: a business may open a conversation, but
 * only with a template Meta has approved in advance. Free-form text is allowed
 * only inside the 24 hours that the candidate's own last message opens. So
 * "send a message" is two operations here, not one, and which is available
 * depends on something the sender cannot see from the request.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/** Meta's code for "you are outside the customer service window". */
const OUTSIDE_WINDOW_CODES = new Set([131047, 131026]);

type GraphError = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

type SendResponse = GraphError & {
  messages?: { id: string }[];
};

async function post(
  credentials: WhatsAppCredentials,
  body: unknown,
): Promise<string> {
  const res = await fetch(
    `${GRAPH}/${credentials.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.accessToken}`,
      },
      body: JSON.stringify(body),
    },
  );

  const json = (await res.json().catch(() => ({}))) as SendResponse;

  if (!res.ok || json.error) {
    const code = json.error?.code;
    // A closed window is not a failure to retry — the caller's recourse is a
    // template, which is a different request. Typed so it can be told apart.
    if (code !== undefined && OUTSIDE_WINDOW_CODES.has(code)) {
      throw new OutsideMessagingWindowError("whatsapp");
    }
    throw new Error(
      json.error?.message ?? `WhatsApp rejected the message (HTTP ${res.status})`,
    );
  }

  const id = json.messages?.[0]?.id;
  if (!id) throw new Error("WhatsApp accepted the message but returned no id");
  return id;
}

export const whatsappProvider: WebhookChannelClient = {
  channel: "whatsapp",
  inbound: "webhook",

  async send(credentialsJson, to, body): Promise<OutboundResult> {
    const credentials = JSON.parse(credentialsJson) as WhatsAppCredentials;
    const externalId = await post(credentials, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    });
    return { externalId };
  },

  async describe(credentialsJson) {
    const credentials = JSON.parse(credentialsJson) as WhatsAppCredentials;
    const res = await fetch(`${GRAPH}/${credentials.phoneNumberId}`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as GraphError & {
      display_phone_number?: string;
      verified_name?: string;
    };
    if (!res.ok || json.error) {
      throw new Error(
        json.error?.message ?? `WhatsApp refused the credentials (HTTP ${res.status})`,
      );
    }
    return {
      accountLabel:
        json.verified_name ?? json.display_phone_number ?? credentials.phoneNumberId,
    };
  },

  /**
   * Whether this really came from Meta.
   *
   * Over the raw bytes, not the parsed object: the signature is of what was
   * sent, and `JSON.parse` then `JSON.stringify` does not reproduce it — key
   * order, whitespace and unicode escapes all change.
   *
   * `timingSafeEqual`, because comparing with `===` leaks how much of a forged
   * signature was right through how long the comparison took.
   */
  verifyWebhook(rawBody, headers, credentialsJson) {
    const credentials = JSON.parse(credentialsJson) as WhatsAppCredentials;
    const header =
      headers["x-hub-signature-256"] ?? headers["X-Hub-Signature-256"];
    if (typeof header !== "string" || !header.startsWith("sha256=")) return false;

    const expected = createHmac("sha256", credentials.appSecret)
      .update(rawBody)
      .digest();
    const given = Buffer.from(header.slice("sha256=".length), "hex");

    // Unequal lengths make timingSafeEqual throw rather than return false.
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  },

  /**
   * The messages in a webhook payload, and nothing else.
   *
   * Meta batches: one POST carries an array of entries, each with an array of
   * changes, each of which may hold messages, delivery statuses, or neither.
   * Anything that is not an inbound text is skipped rather than rejected — a
   * status callback is a normal thing to receive and not an error.
   */
  parseInbound(payload): InboundMessage[] {
    const body = payload as {
      entry?: {
        changes?: {
          value?: {
            contacts?: { wa_id?: string; profile?: { name?: string } }[];
            messages?: {
              id?: string;
              from?: string;
              timestamp?: string;
              type?: string;
              text?: { body?: string };
            }[];
          };
        }[];
      }[];
    };

    const out: InboundMessage[] = [];

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;

        const names = new Map(
          (value.contacts ?? [])
            .filter((c) => c.wa_id)
            .map((c) => [c.wa_id!, c.profile?.name]),
        );

        for (const message of value.messages) {
          // Only text for now. A photo or a voice note arrives with no `text`,
          // and storing an empty body would show a blank bubble that nobody
          // could explain.
          if (message.type !== "text") continue;
          if (!message.id || !message.from || !message.text?.body) continue;

          const name = names.get(message.from);
          out.push({
            externalId: message.id,
            from: message.from,
            ...(name ? { displayName: name } : {}),
            body: message.text.body,
            // Seconds, and a string. `new Date(string)` would read it as a
            // year somewhere in the future.
            sentAt: new Date(Number(message.timestamp ?? 0) * 1000),
          });
        }
      }
    }

    return out;
  },
};

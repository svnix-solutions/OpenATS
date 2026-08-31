import type { messagingChannel } from "../../db/schema/enums";

export type MessagingChannelId = (typeof messagingChannel.enumValues)[number];

/** One message as it arrived, before anything has been matched to a person. */
export interface InboundMessage {
  /** The provider's id for it. Used to make storing it idempotent. */
  externalId: string;
  /** Who sent it, in whatever the channel calls an address. */
  from: string;
  displayName?: string;
  body: string;
  sentAt: Date;
}

export interface OutboundResult {
  externalId: string;
}

/**
 * What a channel can be asked to do.
 *
 * Deliberately not the same interface as `MeetingProviderClient`. A meeting
 * provider is asked to create and cancel a meeting and authenticates a user
 * over OAuth; a channel carries a conversation on behalf of the agency. They
 * share no operation, and folding them together would mean an interface where
 * half the methods throw on half the implementations.
 */
interface BaseChannelClient {
  readonly channel: MessagingChannelId;

  /**
   * Free-form message.
   *
   * May be refused by the channel's own policy rather than by an error in the
   * request — WhatsApp allows this only inside the 24 hours a candidate's own
   * message opens. Implementations surface that as a typed failure rather than
   * a generic one, because the caller's recourse is different: a closed window
   * means send a template, not retry.
   */
  send(
    credentials: string,
    to: string,
    body: string,
  ): Promise<OutboundResult>;

  /** Enough to show in Settings without decrypting anything again. */
  describe(credentials: string): Promise<{ accountLabel: string }>;
}

/**
 * A channel that is pushed messages over HTTP.
 *
 * WhatsApp. The endpoint is public and unauthenticated by anything the app
 * controls, so `verifyWebhook` is the only thing standing between a stranger's
 * POST and a message stored against a candidate.
 */
export interface WebhookChannelClient extends BaseChannelClient {
  readonly inbound: "webhook";
  /**
   * Whether this request really came from the provider. Given the raw body,
   * because a signature is over bytes and `JSON.parse` then `JSON.stringify`
   * does not reproduce them.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    credentials: string,
  ): boolean;
  parseInbound(payload: unknown): InboundMessage[];

  /**
   * Pre-approved messages, for channels that will not carry free-form text
   * outside a window.
   *
   * On the webhook interface rather than the base one because it is not a
   * general idea: it exists because WhatsApp's 24-hour rule exists. Telegram
   * has no window and therefore no templates, and putting these on the shared
   * contract would force it to implement something meaningless.
   */
  listTemplates(credentials: string): Promise<MessageTemplate[]>;
  sendTemplate(
    credentials: string,
    to: string,
    template: { name: string; language: string; parameters: string[] },
  ): Promise<OutboundResult>;
}

/** An approved template, as the screen offering it needs to know about it. */
export interface MessageTemplate {
  name: string;
  language: string;
  category: string | null;
  /** The approved text, placeholders and all, so a person can read it. */
  body: string;
  /** How many `{{n}}` it expects; the wrong number is refused by the provider. */
  parameterCount: number;
}

/**
 * A channel that holds a connection open and is handed messages as they land.
 *
 * Telegram over MTProto. There is no webhook to receive: the client is a long
 * connection that must live in one process, which is why this runs in the
 * worker and not in the API — the API is free to scale to more than one
 * replica and two of them holding the same session would fight.
 */
export interface StreamChannelClient extends BaseChannelClient {
  readonly inbound: "stream";
  /**
   * Starts listening. Resolves to a function that stops it, so a shutdown can
   * close the connection rather than leaving the session logged in.
   */
  listen(
    credentials: string,
    onMessage: (message: InboundMessage) => Promise<void>,
  ): Promise<() => Promise<void>>;
}

export type MessagingChannelClient = WebhookChannelClient | StreamChannelClient;

/** Raised when a channel refuses free-form text by policy rather than error. */
export class OutsideMessagingWindowError extends Error {
  constructor(public readonly channel: MessagingChannelId) {
    super(
      `${channel} will not carry a free-form message right now; the last inbound message is too old`,
    );
    this.name = "OutsideMessagingWindowError";
  }
}

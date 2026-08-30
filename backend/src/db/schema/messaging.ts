import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  messageDelivery,
  messageDirection,
  messagingChannel,
} from "./enums";
import { candidates } from "./candidates";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * The agency's account on a channel.
 *
 * Organization-level, unlike `integration_connections`, which is keyed by user
 * because a Google Calendar belongs to a person. A WhatsApp business number and
 * a Telegram account belong to the agency: a recruiter leaving must not take
 * the channel, and its history, with them.
 *
 * One blob rather than columns per channel. WhatsApp needs a phone number id
 * and an access token; Telegram needs a session string that is equivalent to
 * the account's password. They have nothing in common, and neither belongs in
 * a column that a careless `select()` returns.
 */
export const messagingConnections = pgTable(
  "messaging_connections",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    channel: messagingChannel("channel").notNull(),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    /** Shown in Settings so someone can tell which account this is. */
    accountLabel: varchar("account_label", { length: 255 }),
    connectedBy: integer("connected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    /** Why it stopped working, for the screen that has to explain it. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.organizationId, t.channel)],
);

/**
 * Which address on a channel is this person, and what consent there is.
 *
 * Separate from `candidates.phone` on purpose. A phone number is a fact about
 * someone; an opted-in WhatsApp thread is a relationship. One changes when they
 * change SIM, the other when they ask you to stop — and WhatsApp enforces the
 * second through its quality rating, so "when, and how" has to survive being
 * asked about a year later.
 *
 * Keyed on the person rather than the application: someone who applies to two
 * jobs is still one conversation.
 */
export const candidateChannels = pgTable(
  "candidate_channels",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    channel: messagingChannel("channel").notNull(),
    /** E.164 for WhatsApp, the user id for Telegram. Never a display name. */
    externalId: varchar("external_id", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 255 }),
    optedInAt: timestamp("opted_in_at"),
    optInSource: varchar("opt_in_source", { length: 120 }),
    optedOutAt: timestamp("opted_out_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("candidate_channels_channel_external").on(
      t.organizationId,
      t.channel,
      t.externalId,
    ),
    unique("candidate_channels_candidate_channel").on(t.candidateId, t.channel),
    index("idx_candidate_channels_candidate").on(t.candidateId),
  ],
);

/**
 * What was said, both directions in one table.
 *
 * A thread is then one ordered read rather than a merge of two, which is what
 * the screen showing it actually wants.
 */
export const candidateMessages = pgTable(
  "candidate_messages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    channel: messagingChannel("channel").notNull(),
    direction: messageDirection("direction").notNull(),
    body: text("body").notNull(),
    /** Null for anything inbound, and for a message the system sent itself. */
    sentBy: integer("sent_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * The provider's own id. Unique per channel so a webhook or an update
     * replayed does not store the message twice — delivery is at least once on
     * both channels, and both will resend on a timeout.
     */
    externalId: varchar("external_id", { length: 255 }),
    delivery: messageDelivery("delivery").notNull().default("sent"),
    failureReason: text("failure_reason"),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (t) => [
    unique("candidate_messages_channel_external").on(
      t.organizationId,
      t.channel,
      t.externalId,
    ),
    index("idx_candidate_messages_candidate").on(t.candidateId, t.sentAt),
  ],
);

export type MessagingConnection = typeof messagingConnections.$inferSelect;
export type CandidateChannel = typeof candidateChannels.$inferSelect;
export type CandidateMessage = typeof candidateMessages.$inferSelect;
export type NewCandidateMessage = typeof candidateMessages.$inferInsert;

import {
  AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { messageVisibility } from "./enums";
import { applications, candidates } from "./candidates";
import { jobs } from "./jobs";
import { templates } from "./templates";
import { users } from "./users";
import { organizations } from "./organizations";

export const emailMessages = pgTable(
  "email_messages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),

    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),

    sentBy: integer("sent_by").references(() => users.id, {
      onDelete: "set null",
    }),

    templateId: integer("template_id").references(() => templates.id, {
      onDelete: "set null",
    }),

    subject: varchar("subject", { length: 500 }).notNull(),

    bodyHtml: text("body_html").notNull(),

    recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),

    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (t) => [index("idx_email_messages_candidate_id").on(t.candidateId)],
);

export const jobChatMessages = pgTable(
  "job_chat_messages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),

    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    senderId: integer("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    message: text("message"),

    replyToId: integer("reply_to_id").references(
      (): AnyPgColumn => jobChatMessages.id,
      {
        onDelete: "set null",
      },
    ),

    /**
     * Internal by default. A message written without saying otherwise was
     * written on the assumption no client would read it, so the safe reading
     * of silence is "not for them".
     */
    visibility: messageVisibility("visibility").notNull().default("internal"),

    sentAt: timestamp("sent_at").notNull().defaultNow(),

    isSystemMessage: boolean("is_system_message").notNull().default(false),
    isDeleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => [index("idx_job_chat_messages_job_id").on(t.jobId)],
);

export const candidateChatMessages = pgTable(
  "candidate_chat_messages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),

    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),

    senderId: integer("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    message: text("message"),

    replyToId: integer("reply_to_id").references(
      (): AnyPgColumn => candidateChatMessages.id,
      {
        onDelete: "set null",
      },
    ),

    /**
     * Internal by default. A message written without saying otherwise was
     * written on the assumption no client would read it, so the safe reading
     * of silence is "not for them".
     */
    visibility: messageVisibility("visibility").notNull().default("internal"),

    sentAt: timestamp("sent_at").notNull().defaultNow(),

    isSystemMessage: boolean("is_system_message").notNull().default(false),
    isDeleted: boolean("is_deleted").notNull().default(false),
  },
  (t) => [index("idx_candidate_chat_messages_application_id").on(t.applicationId)],
);

export type EmailMessage = typeof emailMessages.$inferSelect;
export type NewEmailMessage = typeof emailMessages.$inferInsert;

export type JobChatMessage = typeof jobChatMessages.$inferSelect;
export type NewJobChatMessage = typeof jobChatMessages.$inferInsert;

export type CandidateChatMessage = typeof candidateChatMessages.$inferSelect;
export type NewCandidateChatMessage = typeof candidateChatMessages.$inferInsert;

import {
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { templateType } from "./enums";
import { users } from "./users";
import { organizations } from "./organizations";

export type ContentBlock =
  | { type: "heading"; content: string }
  | { type: "text"; content: string }
  | { type: "button"; content: string }
  | { type: "image"; url: string; alt?: string | undefined }
  | { type: "divider" }
  | { type: "spacer"; height: number };

// Email templates store a plain HTML string; event templates store ContentBlock[].
export type TemplateBody = ContentBlock[] | string;

export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(sql`app_current_org()`)
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: templateType("type").notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  bodyJson: jsonb("body_json").$type<TemplateBody>().notNull().default([]),
  // Null for the templates the installation seeds: nobody wrote them. See
  // drizzle/0046 — the NOT NULL made a fresh install unable to send any
  // candidate email, because templates could not exist before a user did.
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;

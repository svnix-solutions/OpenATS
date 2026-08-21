import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";

export const pageSettings = pgTable("public_page_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(sql`app_current_org()`)
    .references(() => organizations.id, { onDelete: "cascade" }),
  allowedOrigins: text("allowed_origins")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PageSettings = typeof pageSettings.$inferSelect;

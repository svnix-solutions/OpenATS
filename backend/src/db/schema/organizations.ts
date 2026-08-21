import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";
import { orgRole } from "./enums";

/**
 * The tenant. One row per recruiting agency, and the boundary every
 * row-level-security policy is written against.
 *
 * A company that only ever hires for itself is an organization with a single
 * client company, so there is no separate single-tenant mode to maintain.
 * See docs-draft/decisions/0001-multi-tenancy.md.
 */
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** A company the organization recruits for. Jobs belong to one of these. */
export const clientCompanies = pgTable(
  "client_companies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 255 }).notNull(),
    /** Used in the public careers URL: /careers/:slug. */
    slug: varchar("slug", { length: 255 }).notNull(),

    website: varchar("website", { length: 500 }),
    description: text("description"),
    logoUrl: varchar("logo_url", { length: 1000 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.slug),
    index("idx_client_companies_organization_id").on(t.organizationId),
  ],
);

/**
 * Who belongs to an organization, and in what capacity.
 *
 * `clientCompanyId` is null for agency staff and set for a client contact,
 * which is what confines them to their own company's jobs.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    role: orgRole("role").notNull(),

    /** Set only for client contacts. Null means agency staff. */
    clientCompanyId: integer("client_company_id").references(
      () => clientCompanies.id,
      { onDelete: "cascade" },
    ),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.organizationId, t.userId),
    index("idx_organization_members_user_id").on(t.userId),
    index("idx_organization_members_client_company_id").on(t.clientCompanyId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type ClientCompany = typeof clientCompanies.$inferSelect;
export type NewClientCompany = typeof clientCompanies.$inferInsert;

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;

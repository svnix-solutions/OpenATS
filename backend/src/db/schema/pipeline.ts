import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { stageType } from "./enums";
import { jobs } from "./jobs";
import { users } from "./users";
import { organizations } from "./organizations";

export const pipelineStageTemplates = pgTable(
  "pipeline_stage_templates",
  {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .notNull()
    .default(sql`app_current_org()`)
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  position: integer("position").notNull(),
  stageType: stageType("stage_type").notNull().default("screening"),
  isDeletable: boolean("is_deletable").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.organizationId, t.name)],
);

export const jobPipelineStages = pgTable(
  "job_pipeline_stages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    name: varchar("name", { length: 100 }).notNull(),

    position: integer("position").notNull(),

    stageType: stageType("stage_type").notNull().default("screening"),

    sourceTemplateId: integer("source_template_id").references(
      () => pipelineStageTemplates.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.jobId, t.position)],
);

export const jobHiringTeam = pgTable(
  "job_hiring_team",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.jobId, t.userId),
    index("idx_job_hiring_team_user_id").on(t.userId),
  ],
);

export type PipelineStageTemplate = typeof pipelineStageTemplates.$inferSelect;
export type NewPipelineStageTemplate =
  typeof pipelineStageTemplates.$inferInsert;

export type JobPipelineStage = typeof jobPipelineStages.$inferSelect;
export type NewJobPipelineStage = typeof jobPipelineStages.$inferInsert;

export type JobHiringTeam = typeof jobHiringTeam.$inferSelect;
export type NewJobHiringTeam = typeof jobHiringTeam.$inferInsert;

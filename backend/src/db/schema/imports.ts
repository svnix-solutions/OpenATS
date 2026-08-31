import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { importStatus } from "./enums";
import { jobs } from "./jobs";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * One run of a candidate import.
 *
 * The import used to be a loop inside the request. A few hundred rows was
 * fine; several thousand hit the timeout partway and left something half done
 * that nobody could see the state of. This row is what makes it observable —
 * the worker advances `processed`, so a screen can say where it is, and the
 * outcome outlives the browser being closed.
 */
export const candidateImports = pgTable(
  "candidate_imports",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }),
    status: importStatus("status").notNull().default("queued"),
    /**
     * The file, because the worker needs it and the request that accepted it
     * is gone. Cleared when the run finishes: it is a list of people's names,
     * emails and phone numbers, and keeping it after it has been read serves
     * nothing.
     */
    csv: text("csv"),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    /**
     * Only the rows that did not import. The ones that did are in
     * `applications`, and storing several thousand successes twice buys
     * nothing.
     */
    problems: jsonb("problems").$type<unknown[]>().notNull().default([]),
    error: text("error"),
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("idx_candidate_imports_job").on(t.jobId, t.createdAt)],
);

export type CandidateImport = typeof candidateImports.$inferSelect;

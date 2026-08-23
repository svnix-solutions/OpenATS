import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { assessmentStatus, candidateStatus, cvAnalysisStatus } from "./enums";
import { jobs } from "./jobs";
import { jobPipelineStages } from "./pipeline";
import { users } from "./users";
import {
  assessments,
  assessmentQuestions,
  assessmentQuestionOptions,
  jobCustomQuestions,
  jobCustomQuestionOptions,
} from "./assessments";
import { organizations } from "./organizations";

export const candidates = pgTable(
  "candidates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),

    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }),
    // Cloudflare R2 URL
    resumeUrl: varchar("resume_url", { length: 1000 }),

    appliedAt: timestamp("applied_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // One person per agency. Which jobs they are up for lives in
    // `applications`, so the same person can be submitted to many.
    unique().on(t.organizationId, t.email),
  ],
);

/**
 * One candidate's submission to one job.
 *
 * Today `candidates` is both a person and an application: it carries contact
 * details alongside `job_id`, `status` and `current_stage_id`. That works for a
 * company hiring for itself and breaks for an agency, where the same person is
 * submitted to Acme in March and Globex in September and the two rows share
 * nothing. See docs-draft/decisions/0001-multi-tenancy.md §4.
 *
 * This table is populated and constrained but not yet read: the service rewrite
 * that moves `status` and `current_stage_id` off `candidates` is a separate
 * change, per 0003.
 */
export const applications = pgTable(
  "applications",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),

    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),

    currentStageId: integer("current_stage_id").references(
      () => jobPipelineStages.id,
      { onDelete: "set null" },
    ),

    status: candidateStatus("status").notNull().default("active"),

    /** Where the submission came from: careers page, referral, agency sourcing. */
    source: varchar("source", { length: 100 }),

    appliedAt: timestamp("applied_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // A person is submitted to a given job once. Re-applying reopens the same
    // application rather than creating a second.
    unique().on(t.candidateId, t.jobId),
    index("idx_applications_candidate_id").on(t.candidateId),
    index("idx_applications_job_id").on(t.jobId),
    index("idx_applications_current_stage_id").on(t.currentStageId),
    index("idx_applications_organization_id").on(t.organizationId),
  ],
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

export const candidateStageHistory = pgTable(
  "candidate_stage_history",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    stageId: integer("stage_id")
      .notNull()
      .references(() => jobPipelineStages.id, { onDelete: "restrict" }),
    movedBy: integer("moved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    movedAt: timestamp("moved_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_candidate_stage_history_application_id").on(t.applicationId),
    index("idx_candidate_stage_history_stage_id").on(t.stageId),
  ],
);

export const candidateCustomAnswers = pgTable(
  "candidate_custom_answers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => jobCustomQuestions.id, { onDelete: "cascade" }),
    // NULL for option-based questions (stored in selections table)
    answerText: text("answer_text"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.applicationId, t.questionId)],
);

export const candidateCustomAnswerSelections = pgTable(
  "candidate_custom_answer_selections",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull()
      .references(() => jobCustomQuestions.id, { onDelete: "cascade" }),
    optionId: integer("option_id")
      .notNull()
      .references(() => jobCustomQuestionOptions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.applicationId, t.questionId, t.optionId)],
);

export const candidateAssessmentAttempts = pgTable(
  "candidate_assessment_attempts",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    assessmentId: integer("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),

    token: varchar("token", { length: 255 }).notNull().unique(),

    status: assessmentStatus("status").notNull().default("pending"),

    expiresAt: timestamp("expires_at").notNull(),

    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    scoreRaw: numeric("score_raw", { precision: 8, scale: 2 }).$type<number>(),
    scoreTotal: numeric("score_total", {
      precision: 8,
      scale: 2,
    }).$type<number>(),
    // (scoreRaw / scoreTotal) * 100
    scorePercentage: numeric("score_percentage", {
      precision: 5,
      scale: 2,
    }).$type<number>(),
    passed: boolean("passed"),

    candidateNameInput: varchar("candidate_name_input", { length: 255 }),
    candidateEmailInput: varchar("candidate_email_input", { length: 255 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_assessment_attempts_application_id").on(t.applicationId)],
);

export const candidateAssessmentAnswers = pgTable(
  "candidate_assessment_answers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    attemptId: integer("attempt_id")
      .notNull()
      .references(() => candidateAssessmentAttempts.id, {
        onDelete: "cascade",
      }),
    questionId: integer("question_id")
      .notNull()
      .references(() => assessmentQuestions.id, { onDelete: "cascade" }),
    answerText: text("answer_text"),
    pointsEarned: numeric("points_earned", {
      precision: 6,
      scale: 2,
    }).$type<number>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.attemptId, t.questionId)],
);

export const candidateAssessmentAnswerSelections = pgTable(
  "candidate_assessment_answer_selections",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    answerId: integer("answer_id")
      .notNull()
      .references(() => candidateAssessmentAnswers.id, { onDelete: "cascade" }),
    optionId: integer("option_id")
      .notNull()
      .references(() => assessmentQuestionOptions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.answerId, t.optionId)],
);

export const candidateCvAnalysis = pgTable(
  "candidate_cv_analysis",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .default(sql`app_current_org()`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    matchScore: numeric("match_score", {
      precision: 5,
      scale: 2,
    }).$type<number>(),

    matchedSkills: text("matched_skills").array(),
    missingSkills: text("missing_skills").array(),

    scoreBreakdown: jsonb("score_breakdown").$type<{
      skills: number;
      experience: number;
      level: number;
      certs: number;
    }>(),

    aiSummary: jsonb("ai_summary").$type<{
      quickSummary: string;
      strengths: string[];
      gaps: string[];
      hiringSignal: string;
      verdict: "strong_fit" | "moderate_fit" | "weak_fit" | "not_recommended";
    }>(),

    extractedText: text("extracted_text"),

    status: cvAnalysisStatus("status").notNull().default("pending"),

    errorMessage: text("error_message"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.candidateId, t.jobId)],
);

export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;

export type CandidateStageHistory = typeof candidateStageHistory.$inferSelect;
export type NewCandidateStageHistory =
  typeof candidateStageHistory.$inferInsert;

export type CandidateCustomAnswer = typeof candidateCustomAnswers.$inferSelect;
export type NewCandidateCustomAnswer =
  typeof candidateCustomAnswers.$inferInsert;

export type CandidateAssessmentAttempt =
  typeof candidateAssessmentAttempts.$inferSelect;
export type NewCandidateAssessmentAttempt =
  typeof candidateAssessmentAttempts.$inferInsert;

export type CandidateAssessmentAnswer =
  typeof candidateAssessmentAnswers.$inferSelect;
export type NewCandidateAssessmentAnswer =
  typeof candidateAssessmentAnswers.$inferInsert;

export type CandidateCvAnalysis = typeof candidateCvAnalysis.$inferSelect;
export type NewCandidateCvAnalysis = typeof candidateCvAnalysis.$inferInsert;

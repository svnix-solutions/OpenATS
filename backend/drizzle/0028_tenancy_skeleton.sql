-- The organization the current connection is acting for, or NULL if none.
--
-- NULLIF is load-bearing: once app.org_id has been set anywhere in a session,
-- current_setting(..., true) returns '' rather than NULL when it is unset, and
-- ''::int raises 22P02. Without it, the request that forgets to set a context
-- crashes instead of seeing nothing. See docs-draft/decisions/0002 section 6.
--
-- STABLE, not IMMUTABLE: the value changes between statements in a session,
-- and marking it IMMUTABLE would let the planner cache it across them.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS integer
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::integer $$;
--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('agency_owner', 'agency_admin', 'recruiter', 'interviewer', 'client_admin', 'client_reviewer');--> statement-breakpoint
CREATE TABLE "client_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"website" varchar(500),
	"description" text,
	"logo_url" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_companies_organization_id_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "org_role" NOT NULL,
	"client_company_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);--> statement-breakpoint
INSERT INTO "organizations" ("name", "slug") VALUES ('Default', 'default') ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
SELECT set_config('app.org_id', (SELECT id::text FROM "organizations" WHERE slug = 'default'), false);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_slug_unique";--> statement-breakpoint
ALTER TABLE "pipeline_stage_templates" DROP CONSTRAINT "pipeline_stage_templates_name_unique";--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_skills" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_hiring_team" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_pipeline_stages" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stage_templates" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_question_options" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_assessment_attachments" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_custom_question_options" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_custom_questions" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_assessment_answer_selections" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_assessment_answers" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_assessment_attempts" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_custom_answer_selections" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_custom_answers" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_cv_analysis" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_stage_history" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_activities" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_chat_messages" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "job_chat_messages" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_rejections" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_interviews" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "public_page_settings" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "organization_id" integer DEFAULT app_current_org() NOT NULL;--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_client_company_id_client_companies_id_fk" FOREIGN KEY ("client_company_id") REFERENCES "public"."client_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_client_companies_organization_id" ON "client_companies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_organization_members_user_id" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_organization_members_client_company_id" ON "organization_members" USING btree ("client_company_id");--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_hiring_team" ADD CONSTRAINT "job_hiring_team_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_pipeline_stages" ADD CONSTRAINT "job_pipeline_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_templates" ADD CONSTRAINT "pipeline_stage_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_question_options" ADD CONSTRAINT "assessment_question_options_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assessment_attachments" ADD CONSTRAINT "job_assessment_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_custom_question_options" ADD CONSTRAINT "job_custom_question_options_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_custom_questions" ADD CONSTRAINT "job_custom_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_answer_selections" ADD CONSTRAINT "candidate_assessment_answer_selections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_answers" ADD CONSTRAINT "candidate_assessment_answers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_attempts" ADD CONSTRAINT "candidate_assessment_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_custom_answer_selections" ADD CONSTRAINT "candidate_custom_answer_selections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_custom_answers" ADD CONSTRAINT "candidate_custom_answers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cv_analysis" ADD CONSTRAINT "candidate_cv_analysis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_stage_history" ADD CONSTRAINT "candidate_stage_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_activities" ADD CONSTRAINT "candidate_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_chat_messages" ADD CONSTRAINT "candidate_chat_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_chat_messages" ADD CONSTRAINT "job_chat_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_rejections" ADD CONSTRAINT "candidate_rejections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interviews" ADD CONSTRAINT "candidate_interviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_page_settings" ADD CONSTRAINT "public_page_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_jobs_organization_id" ON "jobs" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_slug_unique" UNIQUE("organization_id","slug");--> statement-breakpoint
ALTER TABLE "pipeline_stage_templates" ADD CONSTRAINT "pipeline_stage_templates_organization_id_name_unique" UNIQUE("organization_id","name");
--> statement-breakpoint
SELECT set_config('app.org_id', '', false);

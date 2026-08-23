-- Second half of the candidate/application split (0001 §4, sequenced by 0003).
--
-- Order is load-bearing. application_id is backfilled from candidate_id FIRST,
-- while the two are still one-to-one. Merging duplicate people before that
-- would make candidate_id ambiguous — a merged person has several
-- applications and nothing left to say which one a row belonged to.

-- 1. Rows that describe a submission move onto it -------------------------
ALTER TABLE "candidate_stage_history" ADD COLUMN "application_id" integer;--> statement-breakpoint
ALTER TABLE "candidate_custom_answers" ADD COLUMN "application_id" integer;--> statement-breakpoint
ALTER TABLE "candidate_custom_answer_selections" ADD COLUMN "application_id" integer;--> statement-breakpoint
ALTER TABLE "candidate_assessment_attempts" ADD COLUMN "application_id" integer;--> statement-breakpoint

DO $$
DECLARE
  org record;
  t text;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', org.id::text, true);
    FOREACH t IN ARRAY ARRAY['candidate_stage_history','candidate_custom_answers',
                             'candidate_custom_answer_selections',
                             'candidate_assessment_attempts'] LOOP
      EXECUTE format(
        'UPDATE %I r SET application_id = a.id FROM applications a
         WHERE a.candidate_id = r.candidate_id AND r.application_id IS NULL', t);
    END LOOP;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;--> statement-breakpoint

-- Anything left unmatched had no application to belong to, which means it was
-- already orphaned. Dropping it is the honest outcome; NOT NULL below would
-- fail on it otherwise.
DELETE FROM "candidate_stage_history" WHERE "application_id" IS NULL;--> statement-breakpoint
DELETE FROM "candidate_custom_answers" WHERE "application_id" IS NULL;--> statement-breakpoint
DELETE FROM "candidate_custom_answer_selections" WHERE "application_id" IS NULL;--> statement-breakpoint
DELETE FROM "candidate_assessment_attempts" WHERE "application_id" IS NULL;--> statement-breakpoint

ALTER TABLE "candidate_stage_history" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_custom_answers" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_custom_answer_selections" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_assessment_attempts" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "candidate_stage_history" ADD CONSTRAINT "candidate_stage_history_application_id_fk"
  FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "candidate_custom_answers" ADD CONSTRAINT "candidate_custom_answers_application_id_fk"
  FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "candidate_custom_answer_selections" ADD CONSTRAINT "candidate_custom_answer_selections_application_id_fk"
  FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "candidate_assessment_attempts" ADD CONSTRAINT "candidate_assessment_attempts_application_id_fk"
  FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "candidate_stage_history" DROP COLUMN "candidate_id";--> statement-breakpoint
ALTER TABLE "candidate_custom_answers" DROP COLUMN "candidate_id";--> statement-breakpoint
ALTER TABLE "candidate_custom_answer_selections" DROP COLUMN "candidate_id";--> statement-breakpoint
ALTER TABLE "candidate_assessment_attempts" DROP COLUMN "candidate_id";--> statement-breakpoint

CREATE INDEX "idx_candidate_stage_history_application_id" ON "candidate_stage_history" ("application_id");--> statement-breakpoint
CREATE INDEX "idx_assessment_attempts_application_id" ON "candidate_assessment_attempts" ("application_id");--> statement-breakpoint

-- 2. Now the duplicates can be merged --------------------------------------
--
-- The same person applying to two jobs is two rows today, because uniqueness
-- was (job_id, email). Everything that points at the losers is repointed at
-- the lowest id, which becomes the person.
DO $$
DECLARE
  org record;
  dup record;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', org.id::text, true);

    FOR dup IN
      SELECT lower(email) AS email, min(id) AS keep, array_agg(id) AS ids
      FROM candidates WHERE organization_id = org.id
      GROUP BY lower(email) HAVING count(*) > 1
    LOOP
      UPDATE applications SET candidate_id = dup.keep
        WHERE candidate_id = ANY(dup.ids) AND candidate_id <> dup.keep;
      UPDATE offers SET candidate_id = dup.keep WHERE candidate_id = ANY(dup.ids);
      UPDATE candidate_interviews SET candidate_id = dup.keep WHERE candidate_id = ANY(dup.ids);
      UPDATE candidate_cv_analysis SET candidate_id = dup.keep WHERE candidate_id = ANY(dup.ids);
      UPDATE candidate_rejections SET candidate_id = dup.keep WHERE candidate_id = ANY(dup.ids);
      UPDATE candidate_activities SET candidate_id = dup.keep WHERE candidate_id = ANY(dup.ids);
      UPDATE candidate_chat_messages SET candidate_id = dup.keep WHERE candidate_id = ANY(dup.ids);
      UPDATE email_messages SET candidate_id = dup.keep WHERE candidate_id = ANY(dup.ids);

      DELETE FROM candidates
        WHERE id = ANY(dup.ids) AND id <> dup.keep;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;--> statement-breakpoint

-- 3. candidates becomes a person -------------------------------------------
ALTER TABLE "candidates" DROP CONSTRAINT IF EXISTS "candidates_job_id_email_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_candidates_job_id";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_candidates_current_stage_id";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "job_id";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "current_stage_id";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_organization_id_email_unique" UNIQUE("organization_id","email");--> statement-breakpoint

-- A CV is analysed against a job, so one per submission rather than per person.
ALTER TABLE "candidate_cv_analysis" DROP CONSTRAINT IF EXISTS "candidate_cv_analysis_candidate_id_unique";--> statement-breakpoint
ALTER TABLE "candidate_cv_analysis" ADD CONSTRAINT "candidate_cv_analysis_candidate_id_job_id_unique" UNIQUE("candidate_id","job_id");

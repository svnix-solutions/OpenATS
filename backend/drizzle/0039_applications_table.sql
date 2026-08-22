CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer DEFAULT app_current_org() NOT NULL,
	"candidate_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"current_stage_id" integer,
	"status" "candidate_status" DEFAULT 'active' NOT NULL,
	"source" varchar(100),
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "applications_candidate_id_job_id_unique" UNIQUE("candidate_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_current_stage_id_job_pipeline_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."job_pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_applications_candidate_id" ON "applications" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "idx_applications_job_id" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_applications_current_stage_id" ON "applications" USING btree ("current_stage_id");--> statement-breakpoint
CREATE INDEX "idx_applications_organization_id" ON "applications" USING btree ("organization_id");--> statement-breakpoint

-- Same isolation as every other tenant-scoped table. Kept in this migration
-- rather than a follow-up so the table is never reachable without a policy.
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "applications"
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());--> statement-breakpoint

-- Every existing candidate row is already an application — it carries job_id,
-- status and current_stage_id. This lifts that out into its own row without
-- changing what `candidates` holds yet, so nothing reading the old shape
-- breaks. Removing those columns is the follow-up, per 0003.
--
-- Per organization, so the insert satisfies WITH CHECK without depending on
-- the migration role bypassing row-level security.
DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', org.id::text, true);

    INSERT INTO applications
      (organization_id, candidate_id, job_id, current_stage_id, status, applied_at, updated_at)
    SELECT c.organization_id, c.id, c.job_id, c.current_stage_id, c.status,
           c.applied_at, c.updated_at
    FROM candidates c
    WHERE c.organization_id = org.id
    ON CONFLICT (candidate_id, job_id) DO NOTHING;
  END LOOP;

  PERFORM set_config('app.org_id', '', true);
END
$$;

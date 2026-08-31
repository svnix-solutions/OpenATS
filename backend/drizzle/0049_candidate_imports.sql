-- A candidate import, as a job rather than a request.
--
-- The import was a loop inside the HTTP handler: one `apply` per row, all of
-- it before the response. A few hundred rows is fine; several thousand hits
-- the request timeout partway and leaves an import nobody can see the state
-- of, half done.
--
-- This row is what makes it observable. The worker updates `processed` as it
-- goes, so a screen can say where it is, and the outcome survives the browser
-- being closed.
--
-- The CSV is stored here because the worker needs it and the request that
-- accepted it is long gone. It is cleared when the run finishes: it is a list
-- of people's names, emails and phone numbers, and keeping it after it has
-- been read serves nothing.

CREATE TYPE "import_status" AS ENUM ('queued', 'running', 'done', 'failed');--> statement-breakpoint

CREATE TABLE "candidate_imports" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL DEFAULT app_current_org()
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "job_id" integer NOT NULL REFERENCES "jobs"("id") ON DELETE CASCADE,
  "filename" varchar(255),
  "status" "import_status" NOT NULL DEFAULT 'queued',
  -- Cleared once the run finishes. See above.
  "csv" text,
  "total" integer NOT NULL DEFAULT 0,
  "processed" integer NOT NULL DEFAULT 0,
  -- How many rows ended in each outcome.
  "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Only the rows that did not import. The ones that did are in
  -- `applications`, and storing several thousand successes twice buys nothing.
  "problems" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp
);--> statement-breakpoint

CREATE INDEX "idx_candidate_imports_job" ON "candidate_imports" ("job_id", "created_at");--> statement-breakpoint

ALTER TABLE "candidate_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidate_imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "candidate_imports"
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "candidate_imports" TO openats_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "candidate_imports_id_seq" TO openats_app;

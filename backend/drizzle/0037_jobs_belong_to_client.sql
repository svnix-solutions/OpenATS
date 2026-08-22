-- Jobs belong to the company they are being filled for (0001 §7).
--
-- `client_companies` has existed since the tenancy migration and nothing
-- referenced it. This makes it load-bearing.
--
-- Note on what is NOT here: drizzle-kit also wanted to add
-- organizations.asgardeo_org_id, because that column arrived through a
-- hand-written migration and never entered the snapshot. It already exists;
-- re-adding it would fail. Generating this migration refreshed the snapshot,
-- so the drift is resolved from here on.

-- Nullable first. The column cannot be NOT NULL until existing rows have a
-- value, and they have nowhere to point yet.
ALTER TABLE "jobs" ADD COLUMN "client_company_id" integer;--> statement-breakpoint

-- Every organization with jobs gets one client company to hold them. For an
-- agency this is the first of many; for a company hiring for itself it is the
-- only one it will ever have, which is the point — there is no separate
-- in-house case, just an organization with a single client.
--
-- The loop sets the tenant context per organization rather than relying on
-- being a superuser, so this behaves the same whether or not the migration
-- role happens to bypass row-level security.
DO $$
DECLARE
  org record;
  client_id integer;
BEGIN
  FOR org IN SELECT id, name, slug FROM organizations LOOP
    PERFORM set_config('app.org_id', org.id::text, true);

    IF NOT EXISTS (SELECT 1 FROM jobs WHERE organization_id = org.id) THEN
      CONTINUE;
    END IF;

    SELECT id INTO client_id FROM client_companies
    WHERE organization_id = org.id AND slug = org.slug;

    IF client_id IS NULL THEN
      INSERT INTO client_companies (organization_id, name, slug)
      VALUES (org.id, org.name, org.slug)
      RETURNING id INTO client_id;
    END IF;

    UPDATE jobs SET client_company_id = client_id
    WHERE organization_id = org.id AND client_company_id IS NULL;
  END LOOP;

  PERFORM set_config('app.org_id', '', true);
END
$$;--> statement-breakpoint

ALTER TABLE "jobs" ALTER COLUMN "client_company_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_company_id_client_companies_id_fk"
  FOREIGN KEY ("client_company_id") REFERENCES "public"."client_companies"("id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_jobs_client_company_id" ON "jobs" USING btree ("client_company_id");--> statement-breakpoint

-- A slug identifies a job within the company advertising it, which is what the
-- careers URL will address. Organization-wide uniqueness was the right scope
-- only while a tenant had exactly one company.
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_organization_id_slug_unique";--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_company_id_slug_unique" UNIQUE("client_company_id","slug");

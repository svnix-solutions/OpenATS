-- Row-level security for every tenant-scoped table.
--
-- Driven off the catalog rather than a hand-written list: 0002 §2 step 3
-- argues that an enumerated list decays, because the table someone adds in six
-- months is exactly the one nobody remembers to add. Looping over
-- information_schema means this migration covers whatever exists when it runs.
--
-- A table added *later* without an organization_id still gets no policy, which
-- is why the generated sweep in tests/integration/rls-coverage.test.ts asserts
-- the invariant on every run instead of trusting this to be enough.

DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    -- FORCE so the table owner is subject to the policy too. Without it, any
    -- connection that happens to own the table reads straight past isolation.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I '
      'USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())',
      target
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- organizations keys on its own primary key rather than an organization_id.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS org_isolation ON "organizations";--> statement-breakpoint
CREATE POLICY org_isolation ON "organizations"
  USING (id = app_current_org())
  WITH CHECK (id = app_current_org());--> statement-breakpoint

-- users is a global identity, not a tenant-scoped row: one person may belong
-- to more than one organization. Visibility follows membership instead.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS org_isolation ON "users";--> statement-breakpoint
CREATE POLICY org_isolation ON "users"
  USING (EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.user_id = users.id AND m.organization_id = app_current_org()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.user_id = users.id AND m.organization_id = app_current_org()
  ));--> statement-breakpoint

-- Login has to resolve a person to their organization *before* any context
-- exists, which every policy above would prevent. This is the one deliberate
-- hole, kept as narrow as it can be: it takes an Asgardeo subject and returns
-- ids and a role, nothing else, and it is the only SECURITY DEFINER function
-- in the schema.
CREATE OR REPLACE FUNCTION app_resolve_membership(p_asgardeo_user_id text)
RETURNS TABLE (user_id integer, organization_id integer, role text, client_company_id integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, m.organization_id, m.role::text, m.client_company_id
  FROM users u
  JOIN organization_members m ON m.user_id = u.id
  WHERE u.asgardeo_user_id = p_asgardeo_user_id
  LIMIT 1
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_resolve_membership(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_membership(text) TO openats_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_org() TO openats_app;

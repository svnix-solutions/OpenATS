-- One role vocabulary.
--
-- `org_role` and the JWT's `AppRole` were two different names for the same
-- concept, overlapping on only three values. Authorization reads AppRole;
-- nothing ever read `agency_owner`, `agency_admin` or `recruiter`. Two
-- vocabularies for one concept is how the two sides drift, so this collapses
-- them into the one the code actually uses.
--
-- The old values map onto the new ones by what they were used for, not by
-- name: every membership row was written as 'recruiter' by the attach
-- functions regardless of the person's real role, so this backfill is a
-- starting point that the next login corrects (see the attach functions
-- below, which now seed from the token).

ALTER TYPE "public"."org_role" RENAME TO "org_role_old";--> statement-breakpoint

CREATE TYPE "public"."org_role" AS ENUM(
  'super_admin', 'hiring_manager', 'interviewer',
  'client_admin', 'client_reviewer'
);--> statement-breakpoint

ALTER TABLE "organization_members"
  ALTER COLUMN "role" TYPE "public"."org_role"
  USING (CASE "role"::text
    WHEN 'agency_owner'    THEN 'super_admin'
    WHEN 'agency_admin'    THEN 'super_admin'
    WHEN 'recruiter'       THEN 'hiring_manager'
    WHEN 'interviewer'     THEN 'interviewer'
    WHEN 'client_admin'    THEN 'client_admin'
    WHEN 'client_reviewer' THEN 'client_reviewer'
  END)::"public"."org_role";--> statement-breakpoint

DROP TYPE "public"."org_role_old";--> statement-breakpoint

-- Both attach functions hardcoded 'recruiter', so the column could never
-- describe anyone. They now take the role the token presented and seed it on
-- first attach only: ON CONFLICT DO NOTHING means a role an administrator
-- later changes here is not overwritten by the next login. That is the point
-- of moving the source of truth into the database.

CREATE OR REPLACE FUNCTION app_attach_default_membership(
  p_user_id integer,
  p_role    org_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  only_org integer;
BEGIN
  IF EXISTS (SELECT 1 FROM organization_members WHERE user_id = p_user_id) THEN
    RETURN;
  END IF;

  IF (SELECT count(*) FROM organizations) <> 1 THEN
    RETURN;
  END IF;

  SELECT id INTO only_org FROM organizations LIMIT 1;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (only_org, p_user_id, p_role)
  ON CONFLICT DO NOTHING;
END
$$;--> statement-breakpoint

DROP FUNCTION IF EXISTS app_attach_default_membership(integer);--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_attach_membership_by_asgardeo_org(
  p_user_id        integer,
  p_asgardeo_org   text,
  p_role           org_role
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target integer;
BEGIN
  SELECT id INTO target FROM organizations
  WHERE asgardeo_org_id = p_asgardeo_org;

  IF target IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (target, p_user_id, p_role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN target;
END
$$;--> statement-breakpoint

DROP FUNCTION IF EXISTS app_attach_membership_by_asgardeo_org(integer, text);--> statement-breakpoint

REVOKE ALL ON FUNCTION app_attach_default_membership(integer, org_role) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_attach_default_membership(integer, org_role) TO openats_app;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_attach_membership_by_asgardeo_org(integer, text, org_role) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_attach_membership_by_asgardeo_org(integer, text, org_role) TO openats_app;

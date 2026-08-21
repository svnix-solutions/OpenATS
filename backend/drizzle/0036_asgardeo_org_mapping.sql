-- Which organization a person belongs to is properly answered by the Asgardeo
-- sub-organization their token came from (0001 §5). Until now three places
-- answered it with "the only one that exists" and refused when ambiguous.
--
-- Maps a sub-organization to a local tenant. Nullable, because an install that
-- has not adopted sub-organizations has no such id and keeps working through
-- the single-organization path.
ALTER TABLE "organizations"
  ADD COLUMN "asgardeo_org_id" varchar(255);--> statement-breakpoint

CREATE UNIQUE INDEX "idx_organizations_asgardeo_org_id"
  ON "organizations" ("asgardeo_org_id")
  WHERE "asgardeo_org_id" IS NOT NULL;--> statement-breakpoint

-- Attaches a first-time user to the organization their token names.
--
-- Replaces app_attach_default_membership for tokens that carry an
-- organization. That function stays for tokens that do not, so a
-- single-tenant install is unaffected. SECURITY DEFINER for the same reason as
-- the others: this runs before any organization is established.
CREATE OR REPLACE FUNCTION app_attach_membership_by_asgardeo_org(
  p_user_id        integer,
  p_asgardeo_org   text
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

  -- An unmapped sub-organization is not an error to paper over: it means a
  -- tenant exists in the identity provider that nobody has provisioned here.
  -- Returning null makes login fail rather than inventing a tenant.
  IF target IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (target, p_user_id, 'recruiter')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN target;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_attach_membership_by_asgardeo_org(integer, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_attach_membership_by_asgardeo_org(integer, text) TO openats_app;

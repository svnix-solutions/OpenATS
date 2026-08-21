-- A newly provisioned user has no membership, so nothing placed them in an
-- organization and login failed. Which organization a first-time user joins is
-- normally answered by the Asgardeo sub-organization their token came from,
-- and that is phase 3 (0001 §5).
--
-- Until then, attach on first login only when the answer is unambiguous:
-- exactly one organization exists. That keeps a single-tenant install working
-- exactly as it did, and refuses to guess the moment there is more than one
-- tenant to guess between — which is the case where guessing wrong means
-- putting a person inside someone else's data.
CREATE OR REPLACE FUNCTION app_attach_default_membership(p_user_id integer)
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

  SELECT id INTO only_org FROM organizations LIMIT 2;
  IF (SELECT count(*) FROM organizations) <> 1 THEN
    RETURN;
  END IF;

  -- Role is still taken from the JWT; this column is for phase 3.
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (only_org, p_user_id, 'recruiter')
  ON CONFLICT DO NOTHING;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_attach_default_membership(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_attach_default_membership(integer) TO openats_app;

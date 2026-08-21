-- Login happens before any organization is known, so the identity lookup
-- cannot run under a policy that needs one. Doing it in application code broke
-- in a specific and instructive way: a user who already belongs to another
-- organization is invisible, so the lookup missed, provisioning ran, and the
-- insert collided with users_email_unique.
--
-- Moved into a SECURITY DEFINER function so find-reconcile-create happens
-- atomically and outside the boundary. Together with app_resolve_membership
-- these are the only two such functions, and both take a subject and return
-- an identity — never tenant data.
CREATE OR REPLACE FUNCTION app_provision_user(
  p_asgardeo_user_id text,
  p_email            text,
  p_first_name       text,
  p_last_name        text
)
RETURNS users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found users;
BEGIN
  SELECT * INTO found FROM users WHERE asgardeo_user_id = p_asgardeo_user_id;
  IF FOUND THEN
    RETURN found;
  END IF;

  -- The Asgardeo subject changes when a tenant or user is re-provisioned.
  -- Email is the stable identity, so reconcile onto the existing row rather
  -- than colliding with its unique constraint.
  UPDATE users SET asgardeo_user_id = p_asgardeo_user_id, updated_at = now()
  WHERE email = p_email
  RETURNING * INTO found;
  IF FOUND THEN
    RETURN found;
  END IF;

  INSERT INTO users (asgardeo_user_id, email, first_name, last_name)
  VALUES (p_asgardeo_user_id, p_email, p_first_name, p_last_name)
  RETURNING * INTO found;

  RETURN found;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_provision_user(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_provision_user(text, text, text, text) TO openats_app;--> statement-breakpoint

-- Existing users predate organizations, so give them a membership in the
-- bootstrap organization or they cannot log in.
--
-- The role here is a placeholder. The application still takes the acting role
-- from the JWT, as it did before; this column exists for the client portal in
-- phase 3 and is not read yet.
INSERT INTO organization_members (organization_id, user_id, role)
SELECT (SELECT id FROM organizations WHERE slug = 'default'), u.id, 'recruiter'
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
  AND EXISTS (SELECT 1 FROM organizations WHERE slug = 'default')
ON CONFLICT DO NOTHING;

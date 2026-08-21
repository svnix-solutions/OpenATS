-- RETURNS users hands back a single composite column, which the driver maps
-- positionally and then fails to parse. Return explicit columns instead, the
-- same way app_resolve_membership already does.
DROP FUNCTION IF EXISTS app_provision_user(text, text, text, text);--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_provision_user(
  p_asgardeo_user_id text,
  p_email            text,
  p_first_name       text,
  p_last_name        text
)
RETURNS TABLE (
  id               integer,
  asgardeo_user_id varchar,
  first_name       varchar,
  last_name        varchar,
  email            varchar,
  avatar_url       varchar,
  is_active        boolean,
  created_at       timestamp,
  updated_at       timestamp
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id integer;
BEGIN
  SELECT u.id INTO target_id FROM users u
  WHERE u.asgardeo_user_id = p_asgardeo_user_id;

  IF target_id IS NULL THEN
    -- The Asgardeo subject changes when a tenant or user is re-provisioned.
    -- Email is the stable identity, so reconcile onto the existing row rather
    -- than colliding with its unique constraint.
    UPDATE users u SET asgardeo_user_id = p_asgardeo_user_id, updated_at = now()
    WHERE u.email = p_email
    RETURNING u.id INTO target_id;
  END IF;

  IF target_id IS NULL THEN
    INSERT INTO users (asgardeo_user_id, email, first_name, last_name)
    VALUES (p_asgardeo_user_id, p_email, p_first_name, p_last_name)
    RETURNING users.id INTO target_id;
  END IF;

  RETURN QUERY
  SELECT u.id, u.asgardeo_user_id, u.first_name, u.last_name, u.email,
         u.avatar_url, u.is_active, u.created_at, u.updated_at
  FROM users u WHERE u.id = target_id;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_provision_user(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_provision_user(text, text, text, text) TO openats_app;

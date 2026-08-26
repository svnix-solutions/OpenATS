-- The identity provider is no longer Asgardeo, so these names describe
-- something that is not there: `users.asgardeo_user_id` holds an authorizer.dev
-- subject, and the column says otherwise.
--
-- Nothing about behaviour changes. The three SECURITY DEFINER functions that
-- read these columns are re-created with identical bodies and renamed
-- arguments — a function body referencing a renamed column keeps working, but
-- reads as though the old name still exists.

ALTER TABLE "users" RENAME COLUMN "asgardeo_user_id" TO "provider_user_id";--> statement-breakpoint
ALTER TABLE "organizations" RENAME COLUMN "asgardeo_org_id" TO "provider_org_id";--> statement-breakpoint

-- Dropped rather than replaced: the returned row type carries the column name,
-- and Postgres refuses to replace a function whose OUT parameters differ.
DROP FUNCTION IF EXISTS app_provision_user(text, text, text, text);--> statement-breakpoint

CREATE FUNCTION app_provision_user(
  p_provider_user_id text,
  p_email            text,
  p_first_name       text,
  p_last_name        text
)
RETURNS TABLE (
  id               integer,
  provider_user_id varchar,
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
  WHERE u.provider_user_id = p_provider_user_id;

  IF target_id IS NULL THEN
    -- The provider's subject changes when a tenant or user is re-provisioned.
    -- Email is the stable identity, so reconcile onto the existing row rather
    -- than colliding with its unique constraint.
    UPDATE users u SET provider_user_id = p_provider_user_id, updated_at = now()
    WHERE u.email = p_email
    RETURNING u.id INTO target_id;
  END IF;

  IF target_id IS NULL THEN
    INSERT INTO users (provider_user_id, email, first_name, last_name)
    VALUES (p_provider_user_id, p_email, p_first_name, p_last_name)
    RETURNING users.id INTO target_id;
  END IF;

  RETURN QUERY
  SELECT u.id, u.provider_user_id, u.first_name, u.last_name, u.email,
         u.avatar_url, u.is_active, u.created_at, u.updated_at
  FROM users u WHERE u.id = target_id;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_provision_user(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_provision_user(text, text, text, text) TO openats_app;--> statement-breakpoint

-- Same reason: the argument name is part of the signature.
DROP FUNCTION IF EXISTS app_resolve_membership(text);--> statement-breakpoint

CREATE FUNCTION app_resolve_membership(p_provider_user_id text)
RETURNS TABLE (user_id integer, organization_id integer, role text, client_company_id integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, m.organization_id, m.role::text, m.client_company_id
  FROM users u
  JOIN organization_members m ON m.user_id = u.id
  WHERE u.provider_user_id = p_provider_user_id
  LIMIT 1
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_resolve_membership(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_membership(text) TO openats_app;--> statement-breakpoint

CREATE FUNCTION app_attach_membership_by_provider_org(
  p_user_id      integer,
  p_provider_org text,
  p_role         org_role
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
  WHERE provider_org_id = p_provider_org;

  -- An unmapped organization is not an error to paper over: it means a tenant
  -- exists in the identity provider that nobody has provisioned here.
  -- Returning null makes login fail rather than inventing a tenant.
  IF target IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (target, p_user_id, p_role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN target;
END
$$;--> statement-breakpoint

DROP FUNCTION IF EXISTS app_attach_membership_by_asgardeo_org(integer, text, org_role);--> statement-breakpoint

REVOKE ALL ON FUNCTION app_attach_membership_by_provider_org(integer, text, org_role) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_attach_membership_by_provider_org(integer, text, org_role) TO openats_app;

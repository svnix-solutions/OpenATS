-- A careers page is addressed by the company advertising the roles, not by the
-- agency behind it — /careers/acme, not /careers/some-recruiter.
--
-- This is the lookup that lets the public surface stop assuming a single
-- organization: given a client company's slug, which tenant does it belong to.
-- Same shape as the other public resolvers, and the same reason for being
-- SECURITY DEFINER: it runs before any tenant is established.
--
-- Slugs are unique per organization, not globally, so two agencies may each
-- have a client called 'acme'. That makes this ambiguous by construction, and
-- it refuses rather than picking one — a careers page served from the wrong
-- tenant would show the wrong company's jobs.
CREATE OR REPLACE FUNCTION app_resolve_org_by_client_slug(p_slug text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  found integer;
  matches integer;
BEGIN
  SELECT count(*) INTO matches FROM client_companies WHERE slug = p_slug;
  IF matches <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT organization_id INTO found FROM client_companies WHERE slug = p_slug;
  RETURN found;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_resolve_org_by_client_slug(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_org_by_client_slug(text) TO openats_app;

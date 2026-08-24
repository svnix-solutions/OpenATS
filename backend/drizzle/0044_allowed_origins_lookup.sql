-- CORS has to answer before a tenant is known.
--
-- The CORS callback runs before routing: nothing has resolved an organization
-- yet, and an Origin header does not name one. Read through the policy it
-- returned nothing, so every per-organization allowed origin was refused while
-- the settings page went on listing them as allowed. The feature was dead and
-- said nothing.
--
-- `unscopedDb` does not help: it bypasses the proxy, not the policy.
--
-- So this is the seventh SECURITY DEFINER function, and the first that returns
-- something other than ids. That is defensible here and the reasoning should
-- be checked before it is copied:
--
--   * It returns origins and nothing else — no ids, no rows, nothing saying
--     which tenant configured which. A caller learns that some tenant allows
--     a hostname, which is a public fact about a public website.
--   * CORS is not the authorization boundary. Allowing an origin lets a
--     browser read a response it still had to present a valid token for, and
--     that token is scoped to one organization by everything else here.
--
-- What it must never become is a way to ask "which organization owns this
-- origin", which would turn a public hostname into a tenant identifier.

CREATE OR REPLACE FUNCTION app_allowed_origins()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT origin), ARRAY[]::text[])
  FROM public_page_settings, unnest(allowed_origins) AS origin
  WHERE origin IS NOT NULL AND origin <> ''
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_allowed_origins() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_allowed_origins() TO openats_app;

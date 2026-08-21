-- Creates the least-privileged role the application connects as.
--
-- Migrations run as the owner (POSTGRES_USER); the application and the test
-- suite run as this role. That split is what makes row-level security
-- meaningful: superusers bypass RLS unconditionally, and table owners bypass
-- it unless the table is FORCEd, so an application connecting as either one
-- would silently ignore every policy. See docs-draft/decisions/0002.
--
-- Runs automatically for a container with an empty data directory. For a
-- database that already has data, apply it by hand with `make db-role`.
-- Idempotent either way.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openats_app') THEN
    -- Local development password. Production provisions this role out of
    -- band, with its own credentials, before the first RLS migration runs.
    CREATE ROLE openats_app LOGIN PASSWORD 'openats_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO openats_app;

-- Objects that already exist. Empty on a fresh container, which is exactly
-- why the default privileges below matter.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openats_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openats_app;

-- Objects future migrations create. Without this, every migration that adds a
-- table would have to remember to grant on it, and the one that forgets fails
-- at runtime rather than in review.
ALTER DEFAULT PRIVILEGES FOR ROLE openats IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openats_app;
ALTER DEFAULT PRIVILEGES FOR ROLE openats IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO openats_app;

-- Deliberately NOT granted: CREATE on the schema, and any ownership. The
-- application must not be able to add tables, drop policies, or ALTER its way
-- around row-level security.

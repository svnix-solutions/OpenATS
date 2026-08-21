-- INSERT ... RETURNING applies the SELECT policy to the row it returns. So
-- even with `FOR INSERT WITH CHECK (true)`, creating a user failed: the new
-- row has no membership yet, so the SELECT policy hid it and the statement
-- errored. This blocks the just-in-time provisioning that runs on first
-- login, not only the test fixtures.
--
-- Widen SELECT to also permit an identity that belongs to no organization at
-- all. The exposure is a name, an email and an Asgardeo subject for a user who
-- has not been placed anywhere — no tenant data, and normally only for the
-- moment between creating the user and creating their membership. Anything
-- with a membership stays visible only to that membership's organization.

DROP POLICY IF EXISTS users_select ON "users";--> statement-breakpoint

CREATE POLICY users_select ON "users" FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members m
      WHERE m.user_id = users.id AND m.organization_id = app_current_org()
    )
    OR NOT EXISTS (
      SELECT 1 FROM organization_members m WHERE m.user_id = users.id
    )
  );

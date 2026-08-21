-- The single policy on `users` was unsatisfiable for INSERT: WITH CHECK
-- required a membership row for a user that does not exist yet, and the
-- membership cannot be created first because it references the user. Nothing
-- could ever create an identity, including the just-in-time provisioning that
-- runs on first login.
--
-- Split per command. A `users` row on its own carries no tenant data — it is a
-- name, an email and an Asgardeo subject — so creating one is harmless. What
-- matters is that it stays invisible until a membership places it in an
-- organization, which is what the SELECT policy enforces.

DROP POLICY IF EXISTS org_isolation ON "users";--> statement-breakpoint

CREATE POLICY users_select ON "users" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.user_id = users.id AND m.organization_id = app_current_org()
  ));--> statement-breakpoint

-- Anyone may create an identity; it is unreachable until a membership exists.
CREATE POLICY users_insert ON "users" FOR INSERT WITH CHECK (true);--> statement-breakpoint

CREATE POLICY users_update ON "users" FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.user_id = users.id AND m.organization_id = app_current_org()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.user_id = users.id AND m.organization_id = app_current_org()
  ));--> statement-breakpoint

CREATE POLICY users_delete ON "users" FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.user_id = users.id AND m.organization_id = app_current_org()
  ));

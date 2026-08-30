-- Routing an inbound WhatsApp webhook to the organization it belongs to.
--
-- The endpoint is public and unauthenticated: Meta posts to it and nothing in
-- the request carries a session. So the tenant has to be resolved before any
-- context exists, which is what the app_* SECURITY DEFINER functions are for.
--
-- Routed by an opaque token in the path rather than by reading the payload.
-- Two reasons. Meta's verification handshake is a GET with no payload at all,
-- so a body-derived route cannot serve it. And routing on the body means
-- parsing a stranger's JSON to decide which organization's secret to check it
-- against, which is a decision made from untrusted input.
--
-- The token is a routing key, not a credential. A URL is written into a
-- provider's configuration screen, copied into tickets and pasted into chats;
-- what actually authenticates a request is the X-Hub-Signature-256 header,
-- checked against that organization's app secret before anything is stored.

ALTER TABLE "messaging_connections"
  ADD COLUMN "webhook_token" varchar(64);--> statement-breakpoint

-- Unique across every organization, because it is what identifies one. Not
-- part of the tenancy policy: nothing can look this up from inside a request
-- anyway, and a collision would route one agency's messages to another.
CREATE UNIQUE INDEX "messaging_connections_webhook_token"
  ON "messaging_connections" ("webhook_token")
  WHERE "webhook_token" IS NOT NULL;--> statement-breakpoint

-- Takes an identifier, returns an id. Never a row of tenant data — the rule
-- that keeps these functions from becoming a way around the boundary.
CREATE OR REPLACE FUNCTION app_resolve_org_by_messaging_webhook(p_token text)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  found integer;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT organization_id INTO found
  FROM messaging_connections
  WHERE webhook_token = p_token AND is_active
  LIMIT 1;

  RETURN found;
END
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION app_resolve_org_by_messaging_webhook(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_org_by_messaging_webhook(text) TO openats_app;

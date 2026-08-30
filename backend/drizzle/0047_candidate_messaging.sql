-- Two-way messaging with candidates over WhatsApp and Telegram.
--
-- Three tables, and the split is the point:
--
--   messaging_connections  the agency's credentials for a channel. Org-level,
--                          not per-user: a WhatsApp business number and a
--                          Telegram account belong to the agency, and a
--                          recruiter leaving must not take the channel with
--                          them. integration_connections is unique on
--                          (user_id, provider) and is the wrong shape.
--
--   candidate_channels     which address on a channel is this person, and
--                          what consent there is to use it. Separate from
--                          candidates.phone because a phone number is a fact
--                          about someone and an opted-in WhatsApp thread is a
--                          relationship — one changes when they change SIM,
--                          the other when they ask you to stop.
--
--   candidate_messages     what was said. Both directions in one table, so a
--                          thread is one ordered read.

CREATE TYPE "messaging_channel" AS ENUM ('whatsapp', 'telegram');--> statement-breakpoint
CREATE TYPE "message_direction" AS ENUM ('inbound', 'outbound');--> statement-breakpoint

-- Queued and failed are distinct on purpose: a send that never left is a thing
-- to retry, and one the provider refused is a thing to show someone.
CREATE TYPE "message_delivery" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint

CREATE TABLE "messaging_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL DEFAULT app_current_org()
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "channel" "messaging_channel" NOT NULL,
  -- Everything the channel needs to authenticate, encrypted as one blob:
  -- a WhatsApp phone number id and access token, or a Telegram session
  -- string. The shapes have nothing in common and neither belongs in a
  -- column anyone can select by accident.
  "credentials_encrypted" text NOT NULL,
  -- What to show in Settings so somebody can tell which account this is,
  -- without decrypting anything: a phone number, or an @handle.
  "account_label" varchar(255),
  "connected_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  -- One account per channel per agency. Two would make "which one did this
  -- candidate talk to" a question with no answer in the schema.
  CONSTRAINT "messaging_connections_org_channel" UNIQUE ("organization_id", "channel")
);--> statement-breakpoint

CREATE TABLE "candidate_channels" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL DEFAULT app_current_org()
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  -- The person, not the application: someone who applies twice is still one
  -- WhatsApp thread. See CLAUDE.md on which side of that line a column takes.
  "candidate_id" integer NOT NULL REFERENCES "candidates"("id") ON DELETE CASCADE,
  "channel" "messaging_channel" NOT NULL,
  -- What the provider calls them. A WhatsApp E.164 number, or a Telegram
  -- user id. Not a display name: those change.
  "external_id" varchar(255) NOT NULL,
  "display_name" varchar(255),
  -- Consent, recorded rather than assumed. WhatsApp requires opt-in before a
  -- business-initiated template and enforces it through quality rating, so
  -- "when and how" has to survive an audit a year later.
  "opted_in_at" timestamp,
  "opt_in_source" varchar(120),
  "opted_out_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "candidate_channels_channel_external" UNIQUE ("organization_id", "channel", "external_id"),
  CONSTRAINT "candidate_channels_candidate_channel" UNIQUE ("candidate_id", "channel")
);--> statement-breakpoint

CREATE TABLE "candidate_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL DEFAULT app_current_org()
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "candidate_id" integer NOT NULL REFERENCES "candidates"("id") ON DELETE CASCADE,
  "channel" "messaging_channel" NOT NULL,
  "direction" "message_direction" NOT NULL,
  "body" text NOT NULL,
  -- Null for anything inbound, and for a message the system sent itself.
  "sent_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  -- The provider's id for this message. Unique per channel so a webhook or an
  -- update replayed twice does not store the message twice — delivery is at
  -- least once on both channels.
  "external_id" varchar(255),
  "delivery" "message_delivery" NOT NULL DEFAULT 'sent',
  "failure_reason" text,
  "sent_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "candidate_messages_channel_external" UNIQUE ("organization_id", "channel", "external_id")
);--> statement-breakpoint

CREATE INDEX "idx_candidate_messages_candidate" ON "candidate_messages" ("candidate_id", "sent_at");--> statement-breakpoint
CREATE INDEX "idx_candidate_channels_candidate" ON "candidate_channels" ("candidate_id");--> statement-breakpoint

ALTER TABLE "messaging_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "messaging_connections"
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());--> statement-breakpoint

ALTER TABLE "candidate_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidate_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "candidate_channels"
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());--> statement-breakpoint

ALTER TABLE "candidate_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidate_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "candidate_messages"
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "messaging_connections" TO openats_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "candidate_channels" TO openats_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "candidate_messages" TO openats_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "messaging_connections_id_seq" TO openats_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "candidate_channels_id_seq" TO openats_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "candidate_messages_id_seq" TO openats_app;

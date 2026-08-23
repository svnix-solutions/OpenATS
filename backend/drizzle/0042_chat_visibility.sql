-- Who a chat message is for.
--
-- Agency staff discuss candidates candidly on the assumption the client is not
-- reading. A client contact can now sign in and reach their own company's
-- candidates (#23), so that assumption needs enforcing rather than trusting.
--
-- Internal by default, including for every message written before this
-- existed: silence means "written without a client in mind", and the safe
-- reading of that is not-for-them.
CREATE TYPE "public"."message_visibility" AS ENUM('internal', 'shared');--> statement-breakpoint

ALTER TABLE "job_chat_messages"
  ADD COLUMN "visibility" "message_visibility" DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_chat_messages"
  ADD COLUMN "visibility" "message_visibility" DEFAULT 'internal' NOT NULL;

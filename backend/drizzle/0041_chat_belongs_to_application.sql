-- Candidate chat rooms are keyed by submission — that is what the dashboard
-- opens and what the socket join authorises. The column underneath still
-- referenced the person, so a message was stored against whichever person
-- happened to share that id: silently the wrong candidate, with a valid
-- foreign key and no error.
--
-- Per submission is also the right model. "Should we hire Ada for Dev" is not
-- the same conversation as "for Ops".
ALTER TABLE "candidate_chat_messages" ADD COLUMN "application_id" integer;--> statement-breakpoint

-- Existing threads predate the split, when a person had exactly one
-- submission. Where that is still true the thread moves with it; where it is
-- not, there is no way to know which submission it belonged to.
DO $$
DECLARE
  org record;
BEGIN
  FOR org IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.org_id', org.id::text, true);
    UPDATE candidate_chat_messages m
    SET application_id = a.id
    FROM applications a
    WHERE a.candidate_id = m.candidate_id
      AND m.application_id IS NULL
      AND (SELECT count(*) FROM applications x WHERE x.candidate_id = m.candidate_id) = 1;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;--> statement-breakpoint

-- An ambiguous thread cannot be assigned to a submission without guessing, and
-- guessing here means showing one client's discussion on another's candidate.
DELETE FROM "candidate_chat_messages" WHERE "application_id" IS NULL;--> statement-breakpoint

ALTER TABLE "candidate_chat_messages" ALTER COLUMN "application_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_chat_messages" ADD CONSTRAINT "candidate_chat_messages_application_id_fk"
  FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "candidate_chat_messages" DROP COLUMN "candidate_id";--> statement-breakpoint
CREATE INDEX "idx_candidate_chat_messages_application_id"
  ON "candidate_chat_messages" ("application_id");

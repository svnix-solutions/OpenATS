import { describe, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  createScenario,
  destroyScenario,
  itInOrg,
  type Scenario,
} from "../helpers/scenario";
import { applications } from "../../src/db/schema/candidates";
import { candidateChatMessages } from "../../src/db/schema/communications";
import { offers } from "../../src/db/schema/offers";
import { candidateService } from "../../src/modules/candidate/candidate.service";

// `applications` is populated and constrained but not yet read — the service
// rewrite that moves status and current_stage_id off `candidates` is a
// separate change (0003). These cover the structure, so the rewrite has
// something to build against.

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("apps");
});
afterAll(async () => {
  await db.delete(applications).where(eq(applications.organizationId, s.organizationId));
  await destroyScenario(s);
});

describe("applications", () => {
  itInOrg("takes its organization from the connection, like every other table", async () => {
    // personA2 has not applied to jobB, so this pair is free — the scenario
    // already holds personA1/jobA.
    const [row] = await db
      .insert(applications)
      .values({ candidateId: s.personA2, jobId: s.jobB.id })
      .returning();

    expect(row!.organizationId).toBe(s.organizationId);
    expect(row!.status).toBe("active");
  });

  itInOrg("holds one submission per candidate and job", async () => {
    // A person is submitted to a given job once. Re-applying has to reopen the
    // existing application rather than create a second one, which is what the
    // constraint makes impossible to get wrong.
    await expect(
      db
        .insert(applications)
        .values({ candidateId: s.personA1, jobId: s.jobA.id }),
    ).rejects.toThrow();
  });

  itInOrg("lets the same person be submitted to more than one job", async () => {
    // The whole point of the split. Today this is two unrelated candidate rows
    // with the same email; here it is one person with two applications.
    await db
      .insert(applications)
      .values({ candidateId: s.personA1, jobId: s.jobB.id });

    const rows = await db
      .select({ jobId: applications.jobId })
      .from(applications)
      .where(eq(applications.candidateId, s.personA1));

    expect(rows.map((r) => r.jobId).sort()).toEqual(
      [s.jobA.id, s.jobB.id].sort(),
    );
  });

  itInOrg("carries its own status, independent of the other application", async () => {
    await db
      .update(applications)
      .set({ status: "rejected" })
      .where(
        and(
          eq(applications.candidateId, s.personA1),
          eq(applications.jobId, s.jobB.id),
        ),
      );

    const rows = await db
      .select({ jobId: applications.jobId, status: applications.status })
      .from(applications)
      .where(eq(applications.candidateId, s.personA1));

    const byJob = new Map(rows.map((r) => [r.jobId, r.status]));
    expect(byJob.get(s.jobA.id)).toBe("active");
    expect(byJob.get(s.jobB.id)).toBe("rejected");
  });

  itInOrg("keeps a chat thread on its own submission", async () => {
    // Regression: chat rooms are keyed by submission, but the column
    // underneath used to reference the person — so a message landed on
    // whichever person shared that id, with a valid foreign key and no error.
    const [second] = await db
      .insert(applications)
      .values({ candidateId: s.personB1, jobId: s.jobA.id })
      .returning({ id: applications.id });

    await db.insert(candidateChatMessages).values({
      applicationId: s.candidateA1,
      senderId: s.admin.id,
      message: "about this submission",
    });

    const onOther = await db
      .select()
      .from(candidateChatMessages)
      .where(eq(candidateChatMessages.applicationId, second!.id));

    expect(onOther).toEqual([]);

    const onOwn = await db
      .select()
      .from(candidateChatMessages)
      .where(eq(candidateChatMessages.applicationId, s.candidateA1));

    expect(onOwn.map((m) => m.message)).toEqual(["about this submission"]);
  });

  itInOrg("auto-creates an offer against the person, not the submission", async () => {
    // Moving into an offer stage creates a draft offer. `offers.candidate_id`
    // references a person, and application ids share a number space with
    // them — so passing the wrong one attaches the offer to an unrelated
    // candidate with a valid foreign key and no error.
    //
    // core-flows cannot cover this: it creates an offer by hand before
    // reaching the offer stage, so the auto-create branch never runs there.
    // candidateA2 has no offer yet — the fixture's offer is for personA1, and
    // the existing-offer check is per person and job, so this one auto-creates.
    const offerStageId = s.jobA.stageIds[2]!;
    await candidateService.moveStage(s.candidateA2, offerStageId, s.admin.id);

    const [created] = await db
      .select()
      .from(offers)
      .where(
        and(eq(offers.jobId, s.jobA.id), eq(offers.candidateId, s.personA2)),
      );

    expect(created).toBeDefined();
    // Guard: a coincidence between the two id spaces would make this vacuous.
    expect(s.personA2).not.toBe(s.candidateA2);
  });
});

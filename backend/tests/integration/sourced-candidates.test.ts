import { describe, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { applications } from "../../src/db/schema/candidates";
import { candidateChannels } from "../../src/db/schema/messaging";
import { candidateService } from "../../src/modules/candidate/candidate.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * A recruiter entering someone they already knew about.
 *
 * The person did not apply. Two things follow from that and neither is
 * cosmetic: the submission is labelled differently, so a funnel does not count
 * it as an applicant; and no consent to be messaged exists, because a
 * recruiter cannot give it on their behalf.
 */

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("sourced");
});
afterAll(async () => {
  await destroyScenario(s);
});

async function applicationFor(candidateId: number, jobId: number) {
  const [row] = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.candidateId, candidateId),
        eq(applications.jobId, jobId),
      ),
    )
    .limit(1);
  return row ?? null;
}

describe("adding a candidate by hand", () => {
  itInOrg("labels the submission as sourced, not applied", async () => {
    const added = await candidateService.apply(s.jobA.id, {
      firstName: "Old",
      lastName: "Contact",
      email: "sourced@example.test",
      phone: "+49 170 444 5555",
      source: "sourced",
    });

    const application = await applicationFor(added.candidateId, s.jobA.id);
    expect(application?.source).toBe("sourced");
  });

  itInOrg("labels a real application as coming from the careers page", async () => {
    const applied = await candidateService.apply(s.jobA.id, {
      firstName: "Real",
      lastName: "Applicant",
      email: "applied@example.test",
    });

    // The default, so a public application does not have to remember to say
    // where it came from.
    const application = await applicationFor(applied.candidateId, s.jobA.id);
    expect(application?.source).toBe("careers_page");
  });

  itInOrg("adds a submission rather than a second person", async () => {
    // The same email on a second job. Sourcing is full of people already in
    // the system, and a duplicate person splits their history in two.
    const first = await candidateService.apply(s.jobA.id, {
      firstName: "Known",
      lastName: "Person",
      email: "known@example.test",
      source: "sourced",
    });
    const second = await candidateService.apply(s.jobB.id, {
      firstName: "Known",
      lastName: "Person",
      email: "known@example.test",
      source: "sourced",
    });

    expect(second.candidateId).toBe(first.candidateId);
    expect(second.id).not.toBe(first.id);
  });

  itInOrg("gives a sourced candidate no messaging consent", async () => {
    // A phone number off a CV is not permission to open a WhatsApp thread,
    // and a recruiter cannot agree to that on someone else's behalf.
    const added = await candidateService.apply(s.jobB.id, {
      firstName: "No",
      lastName: "Consent",
      email: "noconsent@example.test",
      phone: "+49 170 777 8888",
      source: "sourced",
      messagingOptIn: false,
    });

    const [channel] = await db
      .select()
      .from(candidateChannels)
      .where(eq(candidateChannels.candidateId, added.candidateId))
      .limit(1);

    expect(channel).toBeUndefined();
  });
});

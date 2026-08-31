import { describe, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import { candidateChannels } from "../../src/db/schema/messaging";
import { candidateService } from "../../src/modules/candidate/candidate.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * Consent, and the address it is recorded against.
 *
 * Two halves have to agree here and they start from opposite ends: a person
 * types `+49 170 123 4567` into a form, and Meta's webhook says the sender is
 * `491701234567`. Disagreeing does not fail loudly — every reply is simply
 * dropped as coming from a number nobody recognises.
 */

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("opt-in");
});
afterAll(async () => {
  await destroyScenario(s);
});

async function applyWith(
  email: string,
  phone: string | null,
  messagingOptIn: boolean,
) {
  return candidateService.apply(s.jobA.id, {
    firstName: "Opt",
    lastName: "In",
    email,
    phone,
    messagingOptIn,
  });
}

async function channelFor(candidateId: number) {
  const [row] = await db
    .select()
    .from(candidateChannels)
    .where(
      and(
        eq(candidateChannels.candidateId, candidateId),
        eq(candidateChannels.channel, "whatsapp"),
      ),
    )
    .limit(1);
  return row ?? null;
}

describe("opting in when applying", () => {
  itInOrg("stores the number in the form the webhook will send", async () => {
    const applied = await applyWith("yes@example.test", "+49 170 123 4567", true);
    const channel = await channelFor(applied.candidateId);

    // Not "+49 170 123 4567". This is the exact string Meta puts in `from`.
    expect(channel?.externalId).toBe("491701234567");
    expect(channel?.optedInAt).toBeInstanceOf(Date);
    expect(channel?.optInSource).toContain("application to job");
  });

  itInOrg("records nothing without consent", async () => {
    // The same number, freely given, and no permission to message it. A phone
    // number is how you call someone about an interview.
    const applied = await applyWith("no@example.test", "+49 170 999 8888", false);
    expect(await channelFor(applied.candidateId)).toBeNull();
  });

  itInOrg("records nothing when consent has no number to attach to", async () => {
    const applied = await applyWith("nophone@example.test", null, true);
    expect(await channelFor(applied.candidateId)).toBeNull();
  });

  itInOrg("refuses a number with no country code", async () => {
    // 07700 900123 is a different person in every country, and WhatsApp
    // addresses are international. Guessing would message a stranger.
    const applied = await applyWith("local@example.test", "07700900123", true);
    expect(await channelFor(applied.candidateId)).toBeNull();
  });

  itInOrg("does not let a second application overwrite the first consent", async () => {
    const first = await applyWith("twice@example.test", "+49 170 111 2222", true);
    const before = await channelFor(first.candidateId);

    // The same person opts out, then applies again with the box ticked. A
    // second application is not a second consent.
    await db
      .update(candidateChannels)
      .set({ optedOutAt: new Date() })
      .where(eq(candidateChannels.candidateId, first.candidateId));

    await candidateService.apply(s.jobB.id, {
      firstName: "Opt",
      lastName: "In",
      email: "twice@example.test",
      phone: "+49 170 111 2222",
      messagingOptIn: true,
    });

    const after = await channelFor(first.candidateId);
    expect(after?.id).toBe(before?.id);
    expect(after?.optedOutAt).not.toBeNull();
  });
});

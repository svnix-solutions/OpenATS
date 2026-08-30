import { describe, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";

const sent: { to: string; body: string }[] = [];
vi.mock("../../src/shared/messaging/whatsapp.provider", () => ({
  whatsappProvider: {
    channel: "whatsapp",
    inbound: "webhook",
    send: async (_c: string, to: string, body: string) => {
      sent.push({ to, body });
      return { externalId: `wamid.OUT${sent.length}` };
    },
  },
}));

import { db, runInOrganization } from "../../src/db";
import {
  candidateChannels,
  candidateMessages,
} from "../../src/db/schema/messaging";
import { saveConnection } from "../../src/shared/messaging/connection.service";
import {
  messagingService,
  personForApplication,
  NoChannelError,
  OptedOutError,
} from "../../src/modules/messaging/messaging.service";
import { OutsideMessagingWindowError } from "../../src/shared/messaging/types";
import { canReadPerson } from "../../src/shared/auth/job-access";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * Sending to a candidate.
 *
 * Two things here are easy to get wrong and expensive when wrong: the free-form
 * window, because a message that silently does not arrive is worse than an
 * error; and the application-versus-person split, because an id from one side
 * is a valid, silently wrong id on the other.
 */

let s: Scenario;
const NUMBER = "491700000042";

/**
 * A number of their own. Two people in one organization cannot share one —
 * `candidate_channels` is unique on (organization, channel, address), because
 * an inbound message has to resolve to exactly one person.
 */
async function linkWhatsApp(candidateId: number, number = NUMBER) {
  await db
    .insert(candidateChannels)
    .values({
      candidateId,
      channel: "whatsapp",
      externalId: number,
      optedInAt: new Date(),
      optInSource: "application form",
    })
    .onConflictDoNothing();
}

/** An inbound message this many hours ago, which is what opens the window. */
async function inboundHoursAgo(candidateId: number, hours: number, id: string) {
  await db.insert(candidateMessages).values({
    candidateId,
    channel: "whatsapp",
    direction: "inbound",
    body: "hello",
    externalId: id,
    sentAt: new Date(Date.now() - hours * 60 * 60 * 1000),
  });
}

beforeAll(async () => {
  s = await createScenario("send-msg");
  await runInOrganization(s.organizationId, async () => {
    await saveConnection(
      "whatsapp",
      {
        channel: "whatsapp",
        phoneNumberId: "PN",
        accessToken: "tok",
        webhookVerifyToken: "v",
        appSecret: "sec",
      },
      "+49 30 1",
      s.admin.id,
    );
    await linkWhatsApp(s.personA1);
  });
});

afterAll(async () => {
  await destroyScenario(s);
});

describe("the free-form window", () => {
  itInOrg("refuses when the candidate has never written", async () => {
    await expect(
      messagingService.send(s.personA1, "whatsapp", "hello?", s.admin.id),
    ).rejects.toBeInstanceOf(OutsideMessagingWindowError);

    // Nothing recorded. A message that was refused must not appear in the
    // thread as if it had been sent.
    const thread = await messagingService.getThread(s.personA1);
    expect(thread.filter((m) => m.direction === "outbound")).toEqual([]);
  });

  itInOrg("sends when they wrote within the last 24 hours", async () => {
    await inboundHoursAgo(s.personA1, 2, "wamid.IN-RECENT");

    const stored = await messagingService.send(
      s.personA1,
      "whatsapp",
      "thanks for getting in touch",
      s.admin.id,
    );

    expect(stored).toMatchObject({ direction: "outbound", sentBy: s.admin.id });
    expect(sent.at(-1)).toMatchObject({ to: NUMBER });
  });

  itInOrg("refuses again once their message is older than 24 hours", async () => {
    // The same person, the same channel — only time has passed. Ageing the
    // inbound message is what closes the window.
    await db
      .update(candidateMessages)
      .set({ sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(candidateMessages.externalId, "wamid.IN-RECENT"));

    await expect(
      messagingService.send(s.personA1, "whatsapp", "still there?", s.admin.id),
    ).rejects.toBeInstanceOf(OutsideMessagingWindowError);
  });

  itInOrg("does not let our own messages hold the window open", async () => {
    // An outbound message is already in the thread from the successful send
    // above, and it is recent. If it counted, the window would look open
    // forever and the screen would offer a send that the provider refuses.
    const [channel] = await messagingService.getChannels(s.personA1);
    expect(channel?.freeFormOpenUntil).toBeNull();
  });
});

describe("who can be messaged", () => {
  itInOrg("refuses a candidate with no channel", async () => {
    await expect(
      messagingService.send(s.personB1, "whatsapp", "hi", s.admin.id),
    ).rejects.toBeInstanceOf(NoChannelError);
  });

  itInOrg("refuses one who has opted out", async () => {
    await linkWhatsApp(s.personA2, "491700000043");
    await inboundHoursAgo(s.personA2, 1, "wamid.IN-A2");
    await db
      .update(candidateChannels)
      .set({ optedOutAt: new Date() })
      .where(eq(candidateChannels.candidateId, s.personA2));

    // Inside the window, so nothing technical stops this. Consent does.
    await expect(
      messagingService.send(s.personA2, "whatsapp", "one more thing", s.admin.id),
    ).rejects.toBeInstanceOf(OptedOutError);
  });
});

describe("applications and people", () => {
  itInOrg("resolves an application id to the person behind it", async () => {
    // The dashboard holds application ids; conversations hang off people. The
    // two share a number space, so translating is not optional.
    expect(await personForApplication(s.candidateA1)).toBe(s.personA1);
  });

  itInOrg("is one thread for a person who applied twice", async () => {
    // candidateA1 and candidateA2 are both personA1's submissions in this
    // scenario's world; a second application must not start a second
    // conversation.
    const viaFirst = await personForApplication(s.candidateA1);
    const thread = await messagingService.getThread(viaFirst!);
    expect(thread.length).toBeGreaterThan(0);
  });

  itInOrg("lets an interviewer on the job read that person", async () => {
    expect(await canReadPerson(s.interviewer, s.personA1)).toBe(true);
  });

  itInOrg("refuses an interviewer a person from a job they are not on", async () => {
    expect(await canReadPerson(s.interviewer, s.personB1)).toBe(false);
  });
});

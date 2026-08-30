import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

import { db, runInOrganization } from "../../src/db";
import { candidateChannels, candidateMessages } from "../../src/db/schema/messaging";
import {
  getCredentials,
  listConnections,
  saveConnection,
  markFailed,
} from "../../src/shared/messaging/connection.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * What a messaging channel holds is worse to leak than most rows.
 *
 * A WhatsApp access token sends as the agency. A Telegram MTProto session *is*
 * the account — it cannot be scoped and it does not expire. So the question is
 * not only whether one organization can read another's conversations, but
 * whether it can read the thing that would let it have them.
 */

let s: Scenario;
let other: Scenario;

beforeAll(async () => {
  // The foreign world first: `itInOrg` runs inside whichever scenario was
  // created last, so this order puts the tests inside `s` looking out.
  other = await createScenario("msg-other");
  s = await createScenario("msg");

  await runInOrganization(other.organizationId, () =>
    saveConnection(
      "whatsapp",
      {
        channel: "whatsapp",
        phoneNumberId: "OTHER-PHONE-ID",
        accessToken: "OTHER-SECRET-TOKEN",
        webhookVerifyToken: "v",
        appSecret: "s",
      },
      "+49 30 000000",
      other.admin.id,
    ),
  );

  await runInOrganization(other.organizationId, async () => {
    await db.insert(candidateChannels).values({
      candidateId: other.personA1,
      channel: "whatsapp",
      externalId: "+491700000000",
    });
    await db.insert(candidateMessages).values({
      candidateId: other.personA1,
      channel: "whatsapp",
      direction: "inbound",
      body: "the other agency's candidate said this",
      externalId: "wamid.OTHER",
    });
  });
});

afterAll(async () => {
  await destroyScenario(s);
  await destroyScenario(other);
});

describe("messaging connections", () => {
  itInOrg("does not hand another organization's credentials over", async () => {
    // Nothing here mentions an organization. The policy is the filter, and
    // this is the test that says so.
    expect(await getCredentials("whatsapp")).toBeNull();
  });

  itInOrg("does not list another organization's connections", async () => {
    expect(await listConnections()).toEqual([]);
  });

  itInOrg("stores and returns this organization's own credentials", async () => {
    await saveConnection(
      "telegram",
      { channel: "telegram", apiId: 1, apiHash: "hash", session: "SESSION" },
      "@agency",
      s.admin.id,
    );

    const creds = await getCredentials("telegram");
    expect(creds).toMatchObject({ channel: "telegram", session: "SESSION" });
  });

  itInOrg("keeps the credentials out of what Settings reads", async () => {
    // listConnections is the shape that reaches a browser. A session string
    // appearing here would be the whole account, in a JSON response.
    const [row] = await listConnections();
    expect(Object.keys(row ?? {})).not.toContain("credentialsEncrypted");
    expect(JSON.stringify(row)).not.toContain("SESSION");
  });

  itInOrg("takes a failed channel out of use, with the reason", async () => {
    await markFailed("telegram", "AUTH_KEY_UNREGISTERED");

    // Inactive, so nothing queues behind a session that will never work again.
    expect(await getCredentials("telegram")).toBeNull();
    const [row] = await listConnections();
    expect(row).toMatchObject({ isActive: false, lastError: "AUTH_KEY_UNREGISTERED" });
  });
});

describe("conversations", () => {
  itInOrg("does not show another organization's messages", async () => {
    expect(await db.select().from(candidateMessages)).toEqual([]);
    expect(await db.select().from(candidateChannels)).toEqual([]);
  });

  itInOrg("cannot claim a channel address another organization owns", async () => {
    // The unique constraint is per organization on purpose: two agencies may
    // both recruit the same person, and neither may see that the other does.
    await db.insert(candidateChannels).values({
      candidateId: s.personA1,
      channel: "whatsapp",
      externalId: "+491700000000",
    });

    const rows = await db.select().from(candidateChannels);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.candidateId).toBe(s.personA1);
  });

  itInOrg("stores a thread in one ordered read", async () => {
    await db.insert(candidateMessages).values([
      { candidateId: s.personA1, channel: "whatsapp", direction: "inbound", body: "hello", externalId: "wamid.1" },
      { candidateId: s.personA1, channel: "whatsapp", direction: "outbound", body: "hi", externalId: "wamid.2", sentBy: s.admin.id },
    ]);

    const thread = await db
      .select()
      .from(candidateMessages)
      .where(eq(candidateMessages.candidateId, s.personA1))
      .orderBy(candidateMessages.sentAt, candidateMessages.id);

    expect(thread.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
  });
});

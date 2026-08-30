import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac, randomBytes } from "crypto";
import request from "supertest";
import { and, eq } from "drizzle-orm";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  const { jwks } = await import("../helpers/jwks-holder");
  return { ...actual, createRemoteJWKSet: () => async () => jwks.publicKey };
});

import app from "../../src/app";
import { db, runInOrganization } from "../../src/db";
import {
  candidateChannels,
  candidateMessages,
  messagingConnections,
} from "../../src/db/schema/messaging";
import { saveConnection } from "../../src/shared/messaging/connection.service";
import { initTestKeys } from "../helpers/jwt";
import { createScenario, destroyScenario, type Scenario } from "../helpers/scenario";

/**
 * The inbound WhatsApp webhook.
 *
 * A public, unauthenticated endpoint that writes messages attributed to a
 * candidate. If the signature check is wrong, anyone who has seen the URL can
 * put words in a candidate's mouth inside a system people make hiring
 * decisions from — so these tests are mostly about refusing things.
 */

const APP_SECRET = "an-app-secret";
const CANDIDATE_NUMBER = "491700000001";

let s: Scenario;
let token: string;

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function payload(id: string, text: string) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: CANDIDATE_NUMBER, profile: { name: "A Candidate" } }],
              messages: [
                {
                  id,
                  from: CANDIDATE_NUMBER,
                  timestamp: "1788000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  await initTestKeys();
  s = await createScenario("wa-hook");
  token = randomBytes(24).toString("hex");

  await runInOrganization(s.organizationId, async () => {
    await saveConnection(
      "whatsapp",
      {
        channel: "whatsapp",
        phoneNumberId: "PN1",
        accessToken: "tok",
        webhookVerifyToken: "verify-me",
        appSecret: APP_SECRET,
      },
      "+49 30 123",
      s.admin.id,
    );
    await db
      .update(messagingConnections)
      .set({ webhookToken: token })
      .where(eq(messagingConnections.channel, "whatsapp"));

    await db.insert(candidateChannels).values({
      candidateId: s.personA1,
      channel: "whatsapp",
      externalId: CANDIDATE_NUMBER,
      optedInAt: new Date(),
      optInSource: "application form",
    });
  });
});

afterAll(async () => {
  await destroyScenario(s);
});

describe("the verification handshake", () => {
  it("echoes the challenge for the right verify token", async () => {
    const res = await request(app)
      .get(`/public/webhooks/whatsapp/${token}`)
      .query({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1234" });

    expect(res.status).toBe(200);
    expect(res.text).toBe("1234");
  });

  it("refuses the wrong verify token", async () => {
    const res = await request(app)
      .get(`/public/webhooks/whatsapp/${token}`)
      .query({ "hub.mode": "subscribe", "hub.verify_token": "guessed", "hub.challenge": "1234" });

    expect(res.status).toBe(403);
    expect(res.text).not.toContain("1234");
  });

  it("is a 404 for a token belonging to nobody", async () => {
    const res = await request(app)
      .get(`/public/webhooks/whatsapp/${randomBytes(24).toString("hex")}`)
      .query({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1234" });

    expect(res.status).toBe(404);
  });
});

describe("receiving a message", () => {
  it("stores one that is correctly signed", async () => {
    const body = JSON.stringify(payload("wamid.OK", "I am interested"));

    const res = await request(app)
      .post(`/public/webhooks/whatsapp/${token}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);

    expect(res.status).toBe(200);

    const stored = await runInOrganization(s.organizationId, () =>
      db
        .select()
        .from(candidateMessages)
        .where(eq(candidateMessages.externalId, "wamid.OK")),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      candidateId: s.personA1,
      direction: "inbound",
      body: "I am interested",
    });
  });

  it("refuses one with no signature", async () => {
    const body = JSON.stringify(payload("wamid.NOSIG", "let me in"));

    const res = await request(app)
      .post(`/public/webhooks/whatsapp/${token}`)
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
    await expectNotStored("wamid.NOSIG");
  });

  it("refuses one signed with the wrong secret", async () => {
    const body = JSON.stringify(payload("wamid.WRONGKEY", "let me in"));

    const res = await request(app)
      .post(`/public/webhooks/whatsapp/${token}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body, "not-the-app-secret"))
      .send(body);

    expect(res.status).toBe(401);
    await expectNotStored("wamid.WRONGKEY");
  });

  it("refuses a body that was changed after signing", async () => {
    // The whole point of signing the raw bytes. A signature over the original
    // must not validate the tampered one.
    const original = JSON.stringify(payload("wamid.TAMPER", "no thanks"));
    const tampered = JSON.stringify(payload("wamid.TAMPER", "yes, I accept"));

    const res = await request(app)
      .post(`/public/webhooks/whatsapp/${token}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(original))
      .send(tampered);

    expect(res.status).toBe(401);
    await expectNotStored("wamid.TAMPER");
  });

  it("verifies the bytes that were sent, not a re-serialisation of them", async () => {
    // The signature is over what Meta actually put on the wire. Verifying
    // `JSON.stringify(req.body)` instead looks identical for a payload built
    // in a test — parse and stringify round-trip it exactly — and then fails
    // on real traffic, where whitespace and escaping differ.
    //
    // So this body is pretty-printed. Its bytes are a valid, correctly signed
    // request; its re-serialisation is not the same string.
    const body = JSON.stringify(payload("wamid.WHITESPACE", "spaced out"), null, 2);
    expect(JSON.stringify(JSON.parse(body))).not.toBe(body);

    const res = await request(app)
      .post(`/public/webhooks/whatsapp/${token}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);

    expect(res.status).toBe(200);

    const stored = await runInOrganization(s.organizationId, () =>
      db
        .select()
        .from(candidateMessages)
        .where(eq(candidateMessages.externalId, "wamid.WHITESPACE")),
    );
    expect(stored).toHaveLength(1);
  });

  it("stores a redelivered message once", async () => {
    const body = JSON.stringify(payload("wamid.RETRY", "hello again"));
    const send = () =>
      request(app)
        .post(`/public/webhooks/whatsapp/${token}`)
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sign(body))
        .send(body);

    // Meta resends anything it did not get a 200 for.
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const stored = await runInOrganization(s.organizationId, () =>
      db.select().from(candidateMessages).where(eq(candidateMessages.externalId, "wamid.RETRY")),
    );
    expect(stored).toHaveLength(1);
  });

  it("drops a message from a number no candidate is linked to", async () => {
    const stranger = {
      ...payload("wamid.STRANGER", "who is this"),
    };
    stranger.entry[0]!.changes[0]!.value.messages[0]!.from = "491799999999";
    stranger.entry[0]!.changes[0]!.value.contacts[0]!.wa_id = "491799999999";
    const body = JSON.stringify(stranger);

    const res = await request(app)
      .post(`/public/webhooks/whatsapp/${token}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);

    // 200: it is a real Meta delivery and retrying will not help. But nothing
    // is stored, and no candidate is invented from an unauthenticated claim.
    expect(res.status).toBe(200);
    await expectNotStored("wamid.STRANGER");
  });
});

async function expectNotStored(externalId: string) {
  const rows = await runInOrganization(s.organizationId, () =>
    db
      .select()
      .from(candidateMessages)
      .where(
        and(
          eq(candidateMessages.channel, "whatsapp"),
          eq(candidateMessages.externalId, externalId),
        ),
      ),
  );
  expect(rows).toEqual([]);
}

import { describe, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  const { jwks } = await import("../helpers/jwks-holder");
  return { ...actual, createRemoteJWKSet: () => async () => jwks.publicKey };
});

const sendEmail = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "sent" }));

vi.mock("../../src/shared/services/mail.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/shared/services/mail.service")>();
  return {
    // The real escapeHtml: what it does to the body is half of what is
    // asserted here, and stubbing it would make the escaping test vacuous.
    ...actual,
    mailService: { sendEmail: (...args: unknown[]) => sendEmail(...args) },
  };
});

import app from "../../src/app";
import { db } from "../../src/db";
import { emailMessages } from "../../src/db/schema";
import { initTestKeys, bearer } from "../helpers/jwt";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * Ad-hoc mail to a candidate.
 *
 * This screen shipped as a mockup: the "Send Email" panel kept its list in
 * React state and called nothing, so a recruiter saw their message appear
 * under "Sent Emails" and the candidate was never contacted. What is worth
 * pinning is therefore not the happy path's shape but that a send actually
 * happens, that it is recorded against the right person, and that a failed
 * send does not leave a record claiming otherwise.
 */

let s: Scenario;

beforeAll(async () => {
  await initTestKeys();
  s = await createScenario("cand-email");
});

afterAll(async () => {
  await destroyScenario(s);
});

afterEach(() => {
  sendEmail.mockClear();
  sendEmail.mockResolvedValue({ id: "sent" });
});

async function post(applicationId: number, body: object) {
  return request(app)
    .post(`/api/candidates/${applicationId}/emails`)
    .set(
      "Authorization",
      await bearer({ sub: s.admin.providerUserId, email: s.admin.email }),
    )
    .send(body);
}

describe("emailing a candidate", () => {
  itInOrg("sends the message and records it against the person", async () => {
    const res = await post(s.candidateA1, {
      subject: "Interview invitation",
      body: "Hello,\nWe would like to meet.",
    });

    expect(res.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const [saved] = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, res.body.data.id));

    // `:id` is an application id; this column holds the person. Writing the
    // application id here files the correspondence against whoever happens to
    // share that number.
    expect(saved!.candidateId).not.toBe(s.candidateA1);
    expect(saved!.recipientEmail).toBe(sendEmail.mock.calls[0]![0].to);
    expect(saved!.sentBy).toBeTypeOf("number");
  });

  itInOrg("escapes the recruiter's text and keeps their line breaks", async () => {
    await post(s.candidateA1, {
      subject: "Escaping",
      body: "Regards <b>Team</b>\nSecond line",
    });

    const html = sendEmail.mock.calls[0]![0].html as string;
    // Unescaped, a stray `<` eats the rest of the message, and a pasted tag
    // would be live markup in the candidate's mail client.
    expect(html).toContain("&lt;b&gt;Team&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("<br />");
  });

  itInOrg("records nothing when the send fails", async () => {
    sendEmail.mockRejectedValueOnce(new Error("smtp is down"));

    const res = await post(s.candidateA1, {
      subject: "Never leaves",
      body: "x",
    });

    expect(res.status).toBe(500);

    // The whole point of the feature: a history entry is a claim that someone
    // was contacted. Writing it before the send makes the product lie in
    // exactly the way this screen used to.
    const rows = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.subject, "Never leaves"));
    expect(rows).toHaveLength(0);
  });

  itInOrg("refuses an unknown application", async () => {
    const res = await post(2_000_000_000, { subject: "s", body: "b" });
    expect(res.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  itInOrg("rejects an empty subject or body", async () => {
    expect((await post(s.candidateA1, { subject: "", body: "b" })).status).toBe(400);
    expect((await post(s.candidateA1, { subject: "s", body: "  " })).status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  itInOrg("lists what was sent, newest first", async () => {
    await post(s.candidateA1, { subject: "First", body: "one" });
    await post(s.candidateA1, { subject: "Second", body: "two" });

    const res = await request(app)
      .get(`/api/candidates/${s.candidateA1}/emails`)
      .set(
        "Authorization",
        await bearer({ sub: s.admin.providerUserId, email: s.admin.email }),
      );

    expect(res.status).toBe(200);
    const subjects = (res.body.data as { subject: string }[]).map((e) => e.subject);
    expect(subjects.slice(0, 2)).toEqual(["Second", "First"]);
  });
});

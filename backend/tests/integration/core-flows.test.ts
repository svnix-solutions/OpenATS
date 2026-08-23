import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import request from "supertest";

// Serve the locally generated key instead of fetching a real JWKS. Everything
// else in `jose` stays real, so tokens are genuinely verified.
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  // Import the holder, not the jwt helper: that helper imports `jose` itself,
  // which would deadlock the module graph from inside this factory.
  const { jwks } = await import("../helpers/jwks-holder");
  return {
    ...actual,
    createRemoteJWKSet: () => async () => jwks.publicKey,
  };
});

// No real email in tests. Asserted on below to prove the offer was sent.
const sendOfferEmail = vi.fn().mockResolvedValue(undefined);
const sendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/shared/services/mail.service", () => ({
  // Not just the service: candidate.service imports escapeHtml from here to
  // build the confirmation email. Leaving it out makes that call throw into a
  // catch that only logs, so the email silently stops being sent and every
  // test still passes.
  escapeHtml: (v: string) => v,
  mailService: {
    sendOfferEmail: (...args: unknown[]) => sendOfferEmail(...args),
    sendEmail: (...args: unknown[]) => sendEmail(...args),
    sendInterviewInviteEmail: vi.fn().mockResolvedValue(undefined),
    sendApplicationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

import app from "../../src/app";
import { interviewService } from "../../src/modules/interview/interview.service";
import { db, runInOrganization, unscopedDb } from "../../src/db";
import { company, departments } from "../../src/db/schema/company";
import { jobs } from "../../src/db/schema/jobs";
import { jobPipelineStages, jobHiringTeam } from "../../src/db/schema/pipeline";
import {
  applications,
  candidates,
} from "../../src/db/schema/candidates";
import { candidateInterviews } from "../../src/db/schema/interviews";
import { offers } from "../../src/db/schema/offers";
import { users } from "../../src/db/schema/users";
import {
  clientCompanies,
  organizationMembers,
} from "../../src/db/schema/organizations";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";
import { initTestKeys, bearer } from "../helpers/jwt";

const SUFFIX = `flow-${Date.now()}`;

let auth: string;
let managerId: number;
let companyId: number;
let departmentId: number;
let jobId: number;
let appliedStageId: number;
let interviewStageId: number;
let offerStageId: number;
let candidateId: number;
let offerId: number;

let organizationId: number;
let clientCompanyId: number;

/**
 * `it`, with the body inside the organization.
 *
 * The HTTP calls establish their own context through the middleware; this is
 * for the assertions afterwards, which read the database directly and would
 * otherwise see nothing.
 */
function itInOrg(name: string, fn: () => Promise<void>) {
  return it(name, () => runInOrganization(organizationId, fn));
}

beforeAll(async () => {
  await initTestKeys();
  auth = await bearer({
    sub: `${SUFFIX}-manager`,
    email: `manager.${SUFFIX}@example.test`,
    role: "super_admin",
  });

  organizationId = await createTestOrganization(SUFFIX);

  // The requests below go through authMiddleware, which establishes the
  // organization for itself. Only this fixture seeding runs outside a request,
  // so only it has to say which tenant it is writing into.
  await runInOrganization(organizationId, seedFixtures);
});

async function seedFixtures() {
  // Jobs belong to a client company now.
  const [client] = await db
    .insert(clientCompanies)
    .values({ organizationId, name: `Client ${SUFFIX}`, slug: SUFFIX })
    .returning({ id: clientCompanies.id });
  clientCompanyId = client!.id;

  const [co] = await db
    .insert(company)
    .values({ name: `Co ${SUFFIX}`, email: `co.${SUFFIX}@example.test` })
    .returning({ id: company.id });
  companyId = co!.id;

  const [dept] = await db
    .insert(departments)
    .values({ name: `Dept ${SUFFIX}`, companyId })
    .returning({ id: departments.id });
  departmentId = dept!.id;

  // The token provisions this user on first request, so create it up front to
  // own the job.
  const [manager] = await db
    .insert(users)
    .values({
      asgardeoUserId: `${SUFFIX}-manager`,
      firstName: "Flow",
      lastName: "Manager",
      email: `manager.${SUFFIX}@example.test`,
    })
    .returning({ id: users.id });
  managerId = manager!.id;

  // Membership, not just the user row: login resolves which organization the
  // token acts for, and without this the first request has none.
  await db
    .insert(organizationMembers)
    .values({ organizationId, userId: managerId, role: "recruiter" });

  const [job] = await db
    .insert(jobs)
    .values({
      title: `Engineer ${SUFFIX}`,
      slug: `engineer-${SUFFIX}`,
      description: "Test job",
      employmentType: "full_time",
      clientCompanyId,
      departmentId,
      status: "published",
      createdBy: managerId,
    })
    .returning({ id: jobs.id });
  jobId = job!.id;

  await db.insert(jobHiringTeam).values({ jobId, userId: managerId });

  const stages = await db
    .insert(jobPipelineStages)
    .values([
      { jobId, name: "Applied", position: 1, stageType: "screening" },
      { jobId, name: "Interview", position: 2, stageType: "interview" },
      { jobId, name: "Offer", position: 3, stageType: "offer" },
    ])
    .returning({ id: jobPipelineStages.id });

  appliedStageId = stages[0]!.id;
  interviewStageId = stages[1]!.id;
  offerStageId = stages[2]!.id;
}

afterAll(async () => {
  await runInOrganization(organizationId, teardownFixtures);
  await unscopedDb.execute(
    sql`DELETE FROM organization_members WHERE organization_id = ${organizationId}`,
  );
  await dropTestOrganization(organizationId);
});

async function teardownFixtures() {
  await db
    .delete(candidateInterviews)
    .where(eq(candidateInterviews.jobId, jobId));
  await db.delete(offers).where(eq(offers.jobId, jobId));
  // Submissions first, then the people behind them.
  await db.delete(applications).where(eq(applications.jobId, jobId));
  await db.delete(candidates).where(eq(candidates.organizationId, organizationId));
  await db.delete(jobHiringTeam).where(eq(jobHiringTeam.jobId, jobId));
  await db
    .delete(jobPipelineStages)
    .where(eq(jobPipelineStages.jobId, jobId));
  await db.delete(jobs).where(eq(jobs.id, jobId));
  await db.delete(clientCompanies).where(eq(clientCompanies.id, clientCompanyId));
  await db.delete(departments).where(eq(departments.id, departmentId));
  await db.delete(company).where(eq(company.id, companyId));
  await db
    .delete(users)
    .where(inArray(users.email, [`manager.${SUFFIX}@example.test`]));
}

// Ordered on purpose: each step uses the record the previous one created,
// which is what makes this a flow rather than four isolated cases.
describe("core hiring flow", () => {
  itInOrg("rejects an unauthenticated request", async () => {
    const res = await request(app).get(`/api/candidates/jobs/${jobId}`);
    expect(res.status).toBe(401);
  });

  itInOrg("accepts an application and puts the candidate in the first stage", async () => {
    const res = await request(app)
      .post(`/api/candidates/jobs/${jobId}/apply`)
      .set("Authorization", auth)
      .send({
        firstName: "Ada",
        lastName: "Lovelace",
        email: `ada.${SUFFIX}@example.test`,
        phone: "+10000000000",
      });

    expect(res.status).toBe(201);
    candidateId = res.body.data.id;

    const [row] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, candidateId));

    expect(row!.jobId).toBe(jobId);
    expect(row!.currentStageId).toBe(appliedStageId);
    expect(row!.status).toBe("active");

    // The confirmation email is fire-and-forget inside a catch that only
    // logs, so waitFor rather than an immediate assertion — and asserting it
    // at all is the point: a silent failure here looks exactly like success.
    //
    // It must name the company whose job this is. It used to take whichever
    // `company` row came back first, which on an agency recruiting for
    // several clients meant signing with the wrong company's name.
    await vi.waitFor(() => {
      expect(sendEmail).toHaveBeenCalled();
      const { html } = sendEmail.mock.calls.at(-1)![0] as { html: string };
      expect(html).toContain(`Client ${SUFFIX}`);
    });
  });

  itInOrg("rejects a duplicate application to the same job", async () => {
    const res = await request(app)
      .post(`/api/candidates/jobs/${jobId}/apply`)
      .set("Authorization", auth)
      .send({
        firstName: "Ada",
        lastName: "Lovelace",
        email: `ada.${SUFFIX}@example.test`,
      });

    expect(res.status).toBe(409);
  });

  itInOrg("moves the candidate to another stage", async () => {
    const res = await request(app)
      .put(`/api/candidates/${candidateId}/stage`)
      .set("Authorization", auth)
      .send({ newStageId: interviewStageId });

    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, candidateId));
    expect(row!.currentStageId).toBe(interviewStageId);
  });

  itInOrg("schedules an interview", async () => {
    const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post(`/api/candidates/${candidateId}/interviews`)
      .set("Authorization", auth)
      .send({
        stageId: interviewStageId,
        scheduledAt,
        durationMinutes: 45,
        interviewerId: managerId,
      });

    expect([200, 201]).toContain(res.status);

    // The interview row stores the person; candidateId here is the submission.
    const rows = await interviewService.getByCandidate(candidateId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.durationMinutes).toBe(45);
  });

  itInOrg("creates an offer as a draft", async () => {
    const res = await request(app)
      .post("/api/offers")
      .set("Authorization", auth)
      .send({
        candidateId,
        jobId,
        salary: 120000,
        currency: "USD",
        employmentType: "full_time",
        // The schema uses z.string().date(), so this must be YYYY-MM-DD.
        startDate: new Date(Date.now() + 7 * 86_400_000)
          .toISOString()
          .slice(0, 10),
      });

    expect(res.status).toBe(201);
    offerId = res.body.data.id;
    expect(res.body.data.status).toBe("draft");
  });

  itInOrg("refuses to send an offer that is missing required fields", async () => {
    const res = await request(app)
      .post(`/api/offers/${offerId}/send`)
      .set("Authorization", auth)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reportingManager/);
    expect(sendOfferEmail).not.toHaveBeenCalled();
  });

  itInOrg("accepts the remaining offer details", async () => {
    const res = await request(app)
      .patch(`/api/offers/${offerId}`)
      .set("Authorization", auth)
      .send({
        reportingManager: "Grace Hopper",
        benefits: "Health, dental, 25 days leave",
        offerLetterHtml: "<p>Welcome aboard.</p>",
      });

    expect(res.status).toBe(200);
  });

  // Regression: a partial update used to null out startDate because it was
  // normalized to null before being handed to clean(), which only drops
  // undefined. The offer then became unsendable.
  itInOrg("leaves fields the update did not mention alone", async () => {
    const [row] = await db.select().from(offers).where(eq(offers.id, offerId));
    expect(row!.startDate).not.toBeNull();
    expect(row!.currency).toBe("USD");
  });

  itInOrg("sends the offer and emails the candidate", async () => {
    const res = await request(app)
      .post(`/api/offers/${offerId}/send`)
      .set("Authorization", auth)
      .send({});

    expect(res.status).toBe(200);
    expect(sendOfferEmail).toHaveBeenCalledTimes(1);
    expect(sendOfferEmail.mock.calls[0]![0]).toBe(
      `ada.${SUFFIX}@example.test`,
    );

    const [row] = await db.select().from(offers).where(eq(offers.id, offerId));
    expect(row!.status).toBe("sent");
    expect(row!.sentAt).not.toBeNull();
  });

  itInOrg("moves the candidate to the offer stage", async () => {
    const res = await request(app)
      .put(`/api/candidates/${candidateId}/stage`)
      .set("Authorization", auth)
      .send({ newStageId: offerStageId });

    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, candidateId));
    expect(row!.currentStageId).toBe(offerStageId);
  });
});

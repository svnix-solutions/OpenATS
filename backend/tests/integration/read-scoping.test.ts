import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, runInOrganization } from "../../src/db";
import {
  createTestOrganization,
  dropTestOrganization,
  itInOrg,
} from "../helpers/scenario";
import { company, departments } from "../../src/db/schema/company";
import { jobs } from "../../src/db/schema/jobs";
import { jobHiringTeam, jobPipelineStages } from "../../src/db/schema/pipeline";
import {
  applications,
  candidateAssessmentAttempts,
  candidates,
} from "../../src/db/schema/candidates";
import { assessments } from "../../src/db/schema/assessments";
import { candidateInterviews } from "../../src/db/schema/interviews";
import { offers } from "../../src/db/schema/offers";
import { users } from "../../src/db/schema/users";
import {
  clientCompanies,
  organizationMembers,
} from "../../src/db/schema/organizations";
import {
  canReadAttempt,
  canReadCandidate,
  canReadInterview,
  canReadJob,
  canReadJobSlug,
  canReadOffer,
} from "../../src/shared/auth/job-access";
import {
  requireAttemptRead,
  requireInterviewRead,
  requireJobRead,
  requireOfferRead,
} from "../../src/middlewares/job-access.middleware";
import type { AuthenticatedUser } from "../../src/shared/auth/verify-token";
import type { NextFunction, Request, Response } from "express";

// Record reads use a different rule from the chat rooms: only `interviewer` is
// confined to their hiring team, because the list endpoints already scope that
// role and only that role. The "no regression" cases below are the ones that
// matter — widening this to hiring_manager would lock managers out of records
// their own list endpoints hand them.

const SUFFIX = `read-scope-${Date.now()}`;

let manager: AuthenticatedUser;
let admin: AuthenticatedUser;
let onTeam: AuthenticatedUser;
let offTeam: AuthenticatedUser;

let teamJobId: number;
let otherJobId: number;
let teamJobSlug: string;
let teamCandidateId: number;
let otherCandidateId: number;
let teamOfferId: number;
let otherOfferId: number;
let teamInterviewId: number;
let otherInterviewId: number;
let teamAttemptId: number;
let otherAttemptId: number;
let assessmentId: number;

const MISSING_ID = 2_000_000_000;

async function makeUser(
  tag: string,
  role: AuthenticatedUser["role"],
): Promise<AuthenticatedUser> {
  const [row] = await db
    .insert(users)
    .values({
      asgardeoUserId: `${SUFFIX}-${tag}`,
      firstName: tag,
      lastName: "Tester",
      email: `${tag}.${SUFFIX}@example.test`,
    })
    .returning();
  return { ...row!, role, organizationId, clientCompanyId: null };
}

let organizationId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
  await runInOrganization(organizationId, seedFixtures);
});

async function seedFixtures() {
  // Jobs belong to a client company now.
  const [client] = await db
    .insert(clientCompanies)
    .values({ organizationId, name: `Client ${SUFFIX}`, slug: SUFFIX })
    .returning({ id: clientCompanies.id });
  const clientCompanyId = client!.id;

  const [co] = await db
    .insert(company)
    .values({ name: `Co ${SUFFIX}`, email: `co.${SUFFIX}@example.test` })
    .returning();
  const [dept] = await db
    .insert(departments)
    .values({ companyId: co!.id, name: `Dept ${SUFFIX}` })
    .returning();

  manager = await makeUser("manager", "hiring_manager");
  admin = await makeUser("admin", "super_admin");
  onTeam = await makeUser("on-team", "interviewer");
  offTeam = await makeUser("off-team", "interviewer");

  teamJobSlug = `team-job-${SUFFIX}`;
  await db.insert(organizationMembers).values(
    [manager, admin, onTeam, offTeam].map((u) => ({
      organizationId, userId: u.id, role: "recruiter" as const,
    })),
  );

  const insertedJobs = await db
    .insert(jobs)
    .values([
      {
        slug: teamJobSlug,
        title: "Team Job",
        departmentId: dept!.id,
        employmentType: "full_time",
        clientCompanyId,
        createdBy: admin.id,
      },
      {
        slug: `other-job-${SUFFIX}`,
        title: "Other Job",
        departmentId: dept!.id,
        employmentType: "full_time",
        clientCompanyId,
        createdBy: admin.id,
      },
    ])
    .returning({ id: jobs.id });
  teamJobId = insertedJobs[0]!.id;
  otherJobId = insertedJobs[1]!.id;

  await db
    .insert(jobHiringTeam)
    .values([{ jobId: teamJobId, userId: onTeam.id }]);

  const stages = await db
    .insert(jobPipelineStages)
    .values([
      { jobId: teamJobId, name: "Applied", position: 1 },
      { jobId: otherJobId, name: "Applied", position: 1 },
    ])
    .returning({ id: jobPipelineStages.id });

  const insertedCandidates = await db
    .insert(candidates)
    .values([
      {
        firstName: "Team",
        lastName: "Candidate",
        email: `team.cand.${SUFFIX}@example.test`,
      },
      {
        firstName: "Other",
        lastName: "Candidate",
        email: `other.cand.${SUFFIX}@example.test`,
      },
    ])
    .returning({ id: candidates.id });
  // These ids are submissions: that is what every access check here is about.
  const submissions = await db
    .insert(applications)
    .values([
      { candidateId: insertedCandidates[0]!.id, jobId: teamJobId },
      { candidateId: insertedCandidates[1]!.id, jobId: otherJobId },
    ])
    .returning({ id: applications.id });

  // Offers and interviews reference the person, not the submission.
  const teamPersonId = insertedCandidates[0]!.id;
  const otherPersonId = insertedCandidates[1]!.id;

  teamCandidateId = submissions[0]!.id;
  otherCandidateId = submissions[1]!.id;

  const insertedOffers = await db
    .insert(offers)
    .values([
      { candidateId: teamPersonId, jobId: teamJobId, createdBy: admin.id },
      { candidateId: otherPersonId, jobId: otherJobId, createdBy: admin.id },
    ])
    .returning({ id: offers.id });
  teamOfferId = insertedOffers[0]!.id;
  otherOfferId = insertedOffers[1]!.id;

  const insertedInterviews = await db
    .insert(candidateInterviews)
    .values([
      {
        candidateId: teamPersonId,
        jobId: teamJobId,
        stageId: stages[0]!.id,
      },
      {
        candidateId: otherPersonId,
        jobId: otherJobId,
        stageId: stages[1]!.id,
      },
    ])
    .returning({ id: candidateInterviews.id });
  teamInterviewId = insertedInterviews[0]!.id;
  otherInterviewId = insertedInterviews[1]!.id;

  const [assessment] = await db
    .insert(assessments)
    .values({
      title: `Assessment ${SUFFIX}`,
      timeLimit: 30,
      createdBy: admin.id,
    })
    .returning({ id: assessments.id });
  assessmentId = assessment!.id;

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const insertedAttempts = await db
    .insert(candidateAssessmentAttempts)
    .values([
      {
        applicationId: teamCandidateId,
        assessmentId,
        token: `team-token-${SUFFIX}`,
        expiresAt,
      },
      {
        applicationId: otherCandidateId,
        assessmentId,
        token: `other-token-${SUFFIX}`,
        expiresAt,
      },
    ])
    .returning({ id: candidateAssessmentAttempts.id });
  teamAttemptId = insertedAttempts[0]!.id;
  otherAttemptId = insertedAttempts[1]!.id;
}

afterAll(async () => {
  await runInOrganization(organizationId, teardownFixtures);
  await dropTestOrganization(organizationId);
});

async function teardownFixtures() {
  await db
    .delete(candidateAssessmentAttempts)
    .where(
      inArray(candidateAssessmentAttempts.id, [teamAttemptId, otherAttemptId]),
    );
  await db.delete(assessments).where(eq(assessments.id, assessmentId));
  await db
    .delete(candidateInterviews)
    .where(inArray(candidateInterviews.id, [teamInterviewId, otherInterviewId]));
  await db.delete(offers).where(inArray(offers.id, [teamOfferId, otherOfferId]));
  await db
    .delete(candidates)
    .where(inArray(candidates.id, [teamCandidateId, otherCandidateId]));
  await db
    .delete(jobPipelineStages)
    .where(inArray(jobPipelineStages.jobId, [teamJobId, otherJobId]));
  // Submissions hold a restrict reference to jobs, so they go first.
  await db
    .delete(applications)
    .where(inArray(applications.jobId, [teamJobId, otherJobId]));
  await db.delete(jobs).where(inArray(jobs.id, [teamJobId, otherJobId]));
  const userIds = [manager.id, admin.id, onTeam.id, offTeam.id];
  await db
    .delete(organizationMembers)
    .where(inArray(organizationMembers.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.delete(company).where(eq(company.email, `co.${SUFFIX}@example.test`));
}

describe("canReadJob", () => {
  itInOrg("allows an interviewer on the hiring team", async () => {
    expect(await canReadJob(onTeam, teamJobId)).toBe(true);
  });

  itInOrg("denies an interviewer not on the hiring team", async () => {
    expect(await canReadJob(offTeam, teamJobId)).toBe(false);
  });

  itInOrg("allows hiring_manager for a job they are not on (no regression)", async () => {
    expect(await canReadJob(manager, teamJobId)).toBe(true);
  });

  itInOrg("allows super_admin", async () => {
    expect(await canReadJob(admin, teamJobId)).toBe(true);
  });

  itInOrg("denies an interviewer for a job that does not exist", async () => {
    expect(await canReadJob(offTeam, MISSING_ID)).toBe(false);
  });
});

describe("canReadJobSlug", () => {
  itInOrg("resolves the slug and allows an interviewer on the team", async () => {
    expect(await canReadJobSlug(onTeam, teamJobSlug)).toBe(true);
  });

  itInOrg("denies an interviewer off the team", async () => {
    expect(await canReadJobSlug(offTeam, teamJobSlug)).toBe(false);
  });

  itInOrg("denies an unknown slug rather than leaking that it is unknown", async () => {
    expect(await canReadJobSlug(offTeam, `no-such-slug-${SUFFIX}`)).toBe(false);
  });
});

describe("record reads resolve through to the owning job", () => {
  it.each([
    ["an on-team interviewer may read an offer on that job", () => canReadOffer(onTeam, teamOfferId), true],
    ["an off-team interviewer may not read an offer on that job", () => canReadOffer(offTeam, teamOfferId), false],
    ["an off-team interviewer may not read an offer on any other job either", () => canReadOffer(offTeam, otherOfferId), false],
    ["a manager may read an offer on a job they are not on", () => canReadOffer(manager, otherOfferId), true],
    ["an on-team interviewer may read an interview on that job", () => canReadInterview(onTeam, teamInterviewId), true],
    ["an off-team interviewer may not read an interview on that job", () => canReadInterview(offTeam, teamInterviewId), false],
    ["a manager may read an interview on a job they are not on", () => canReadInterview(manager, otherInterviewId), true],
    ["an on-team interviewer may read an attempt by a candidate on that job", () => canReadAttempt(onTeam, teamAttemptId), true],
    ["an off-team interviewer may not read an attempt by a candidate on that job", () => canReadAttempt(offTeam, teamAttemptId), false],
    ["a manager may read an attempt on a job they are not on", () => canReadAttempt(manager, otherAttemptId), true],
    ["an on-team interviewer may read a candidate on that job", () => canReadCandidate(onTeam, teamCandidateId), true],
    ["an off-team interviewer may not read a candidate on that job", () => canReadCandidate(offTeam, teamCandidateId), false],
    ["a manager may read a candidate on a job they are not on", () => canReadCandidate(manager, otherCandidateId), true],
  ])("%s", async (_label, run, expected) => {
    // it.each cannot go through itInOrg, so the context is established here.
    await runInOrganization(organizationId, async () => {
      expect(await run()).toBe(expected);
    });
  });

  itInOrg("denies records that do not exist", async () => {
    expect(await canReadOffer(offTeam, MISSING_ID)).toBe(false);
    expect(await canReadInterview(offTeam, MISSING_ID)).toBe(false);
    expect(await canReadAttempt(offTeam, MISSING_ID)).toBe(false);
  });
});

// Driven directly: the real route needs a signed token we cannot issue here.
function runMiddleware(
  middleware: ReturnType<typeof requireJobRead>,
  user: AuthenticatedUser,
  params: Record<string, string>,
) {
  return new Promise<{ status: number | null; passed: boolean }>((resolve) => {
    let status: number | null = null;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        resolve({ status, passed: false });
        return this;
      },
    } as unknown as Response;

    const next: NextFunction = () => resolve({ status: null, passed: true });

    void middleware({ user, params } as unknown as Request, res, next);
  });
}

describe("read middleware", () => {
  itInOrg("lets an on-team interviewer through to a job", async () => {
    const result = await runMiddleware(requireJobRead("id"), onTeam, {
      id: String(teamJobId),
    });
    expect(result.passed).toBe(true);
  });

  itInOrg("rejects an off-team interviewer with 403", async () => {
    const result = await runMiddleware(requireJobRead("id"), offTeam, {
      id: String(teamJobId),
    });
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
  });

  itInOrg("rejects a malformed id with 400 before touching the database", async () => {
    const result = await runMiddleware(requireJobRead("id"), offTeam, {
      id: "not-a-number",
    });
    expect(result.status).toBe(400);
  });

  itInOrg("guards offers by their job", async () => {
    expect(
      (await runMiddleware(requireOfferRead(), offTeam, {
        id: String(teamOfferId),
      })).status,
    ).toBe(403);
    expect(
      (await runMiddleware(requireOfferRead(), onTeam, {
        id: String(teamOfferId),
      })).passed,
    ).toBe(true);
  });

  itInOrg("guards interviews by their job", async () => {
    expect(
      (await runMiddleware(requireInterviewRead(), offTeam, {
        id: String(teamInterviewId),
      })).status,
    ).toBe(403);
    expect(
      (await runMiddleware(requireInterviewRead(), onTeam, {
        id: String(teamInterviewId),
      })).passed,
    ).toBe(true);
  });

  itInOrg("guards assessment attempts through the candidate's job", async () => {
    expect(
      (await runMiddleware(requireAttemptRead(), offTeam, {
        attemptId: String(teamAttemptId),
      })).status,
    ).toBe(403);
    expect(
      (await runMiddleware(requireAttemptRead(), onTeam, {
        attemptId: String(teamAttemptId),
      })).passed,
    ).toBe(true);
  });

  itInOrg("stops an off-team interviewer adding a candidate to a job", async () => {
    // The write side of the same rule. Reads were scoped in #2; this route
    // had no job guard at all, so anyone signed in could put a candidate
    // into any job in the organization.
    expect(
      (await runMiddleware(requireJobRead("jobId"), offTeam, {
        jobId: String(teamJobId),
      })).status,
    ).toBe(403);

    expect(
      (await runMiddleware(requireJobRead("jobId"), onTeam, {
        jobId: String(teamJobId),
      })).passed,
    ).toBe(true);
  });
});

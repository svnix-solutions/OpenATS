import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/db";
import { company, departments } from "../../src/db/schema/company";
import { jobs } from "../../src/db/schema/jobs";
import { jobHiringTeam, jobPipelineStages } from "../../src/db/schema/pipeline";
import {
  candidateAssessmentAttempts,
  candidates,
} from "../../src/db/schema/candidates";
import { assessments } from "../../src/db/schema/assessments";
import { candidateInterviews } from "../../src/db/schema/interviews";
import { offers } from "../../src/db/schema/offers";
import { users } from "../../src/db/schema/users";
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
  return { ...row!, role };
}

beforeAll(async () => {
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
  const insertedJobs = await db
    .insert(jobs)
    .values([
      {
        slug: teamJobSlug,
        title: "Team Job",
        departmentId: dept!.id,
        employmentType: "full_time",
        createdBy: admin.id,
      },
      {
        slug: `other-job-${SUFFIX}`,
        title: "Other Job",
        departmentId: dept!.id,
        employmentType: "full_time",
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
        jobId: teamJobId,
      },
      {
        firstName: "Other",
        lastName: "Candidate",
        email: `other.cand.${SUFFIX}@example.test`,
        jobId: otherJobId,
      },
    ])
    .returning({ id: candidates.id });
  teamCandidateId = insertedCandidates[0]!.id;
  otherCandidateId = insertedCandidates[1]!.id;

  const insertedOffers = await db
    .insert(offers)
    .values([
      { candidateId: teamCandidateId, jobId: teamJobId, createdBy: admin.id },
      { candidateId: otherCandidateId, jobId: otherJobId, createdBy: admin.id },
    ])
    .returning({ id: offers.id });
  teamOfferId = insertedOffers[0]!.id;
  otherOfferId = insertedOffers[1]!.id;

  const insertedInterviews = await db
    .insert(candidateInterviews)
    .values([
      {
        candidateId: teamCandidateId,
        jobId: teamJobId,
        stageId: stages[0]!.id,
      },
      {
        candidateId: otherCandidateId,
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
        candidateId: teamCandidateId,
        assessmentId,
        token: `team-token-${SUFFIX}`,
        expiresAt,
      },
      {
        candidateId: otherCandidateId,
        assessmentId,
        token: `other-token-${SUFFIX}`,
        expiresAt,
      },
    ])
    .returning({ id: candidateAssessmentAttempts.id });
  teamAttemptId = insertedAttempts[0]!.id;
  otherAttemptId = insertedAttempts[1]!.id;
});

afterAll(async () => {
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
  await db.delete(jobs).where(inArray(jobs.id, [teamJobId, otherJobId]));
  await db
    .delete(users)
    .where(inArray(users.id, [manager.id, admin.id, onTeam.id, offTeam.id]));
  await db.delete(company).where(eq(company.email, `co.${SUFFIX}@example.test`));
});

describe("canReadJob", () => {
  it("allows an interviewer on the hiring team", async () => {
    expect(await canReadJob(onTeam, teamJobId)).toBe(true);
  });

  it("denies an interviewer not on the hiring team", async () => {
    expect(await canReadJob(offTeam, teamJobId)).toBe(false);
  });

  it("allows hiring_manager for a job they are not on (no regression)", async () => {
    expect(await canReadJob(manager, teamJobId)).toBe(true);
  });

  it("allows super_admin", async () => {
    expect(await canReadJob(admin, teamJobId)).toBe(true);
  });

  it("denies an interviewer for a job that does not exist", async () => {
    expect(await canReadJob(offTeam, MISSING_ID)).toBe(false);
  });
});

describe("canReadJobSlug", () => {
  it("resolves the slug and allows an interviewer on the team", async () => {
    expect(await canReadJobSlug(onTeam, teamJobSlug)).toBe(true);
  });

  it("denies an interviewer off the team", async () => {
    expect(await canReadJobSlug(offTeam, teamJobSlug)).toBe(false);
  });

  it("denies an unknown slug rather than leaking that it is unknown", async () => {
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
    expect(await run()).toBe(expected);
  });

  it("denies records that do not exist", async () => {
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
  it("lets an on-team interviewer through to a job", async () => {
    const result = await runMiddleware(requireJobRead("id"), onTeam, {
      id: String(teamJobId),
    });
    expect(result.passed).toBe(true);
  });

  it("rejects an off-team interviewer with 403", async () => {
    const result = await runMiddleware(requireJobRead("id"), offTeam, {
      id: String(teamJobId),
    });
    expect(result.passed).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects a malformed id with 400 before touching the database", async () => {
    const result = await runMiddleware(requireJobRead("id"), offTeam, {
      id: "not-a-number",
    });
    expect(result.status).toBe(400);
  });

  it("guards offers by their job", async () => {
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

  it("guards interviews by their job", async () => {
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

  it("guards assessment attempts through the candidate's job", async () => {
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
});

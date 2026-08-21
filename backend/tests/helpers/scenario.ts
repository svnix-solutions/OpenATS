import { eq, inArray } from "drizzle-orm";
import { db } from "../../src/db";
import { company, departments } from "../../src/db/schema/company";
import { jobs, jobSkills } from "../../src/db/schema/jobs";
import { jobHiringTeam, jobPipelineStages } from "../../src/db/schema/pipeline";
import {
  candidateAssessmentAttempts,
  candidates,
} from "../../src/db/schema/candidates";
import { assessments } from "../../src/db/schema/assessments";
import { candidateInterviews } from "../../src/db/schema/interviews";
import { offers } from "../../src/db/schema/offers";
import { users } from "../../src/db/schema/users";
import type { AuthenticatedUser } from "../../src/shared/auth/verify-token";

// One coherent world for the characterization suites to read.
//
// Two jobs, with the interviewer on the hiring team of the first and not the
// second. That is the shape every scoping question in these tests reduces to:
// "does this service still hide job B from someone who only works on job A".

export interface ScenarioJob {
  id: number;
  slug: string;
  stageIds: number[];
}

export interface Scenario {
  suffix: string;
  companyId: number;
  departmentId: number;
  admin: AuthenticatedUser;
  manager: AuthenticatedUser;
  /** On jobA's hiring team, deliberately not on jobB's. */
  interviewer: AuthenticatedUser;
  jobA: ScenarioJob;
  jobB: ScenarioJob;
  /** a1 and a2 are on jobA, b1 is on jobB. */
  candidateA1: number;
  candidateA2: number;
  candidateB1: number;
  offerA1: number;
  offerB1: number;
  interviewA1: number;
  interviewB1: number;
  assessmentId: number;
  attemptA1: number;
  attemptB1: number;
}

let counter = 0;

async function makeUser(
  suffix: string,
  tag: string,
  role: AuthenticatedUser["role"],
): Promise<AuthenticatedUser> {
  const [row] = await db
    .insert(users)
    .values({
      asgardeoUserId: `${suffix}-${tag}`,
      firstName: tag,
      lastName: "Fixture",
      email: `${tag}.${suffix}@example.test`,
    })
    .returning();
  return { ...row!, role };
}

async function makeJob(
  suffix: string,
  tag: string,
  departmentId: number,
  createdBy: number,
): Promise<ScenarioJob> {
  const slug = `${tag}-${suffix}`;
  const [job] = await db
    .insert(jobs)
    .values({
      slug,
      title: `${tag} Engineer`,
      departmentId,
      employmentType: "full_time",
      status: "published",
      createdBy,
    })
    .returning({ id: jobs.id });

  const stages = await db
    .insert(jobPipelineStages)
    .values([
      { jobId: job!.id, name: "Applied", position: 1, stageType: "screening" },
      { jobId: job!.id, name: "Interview", position: 2, stageType: "interview" },
      { jobId: job!.id, name: "Offer", position: 3, stageType: "offer" },
    ])
    .returning({ id: jobPipelineStages.id });

  await db
    .insert(jobSkills)
    .values([
      { jobId: job!.id, skill: "typescript" },
      { jobId: job!.id, skill: "postgres" },
    ]);

  return { id: job!.id, slug, stageIds: stages.map((s) => s.id) };
}

export async function createScenario(tag: string): Promise<Scenario> {
  // Unique per call: vitest runs files in parallel, and jobs.slug and
  // users.email are globally unique.
  const suffix = `${tag}-${Date.now()}-${counter++}`;

  const [co] = await db
    .insert(company)
    .values({ name: `Co ${suffix}`, email: `co.${suffix}@example.test` })
    .returning();
  const [dept] = await db
    .insert(departments)
    .values({ companyId: co!.id, name: `Dept ${suffix}` })
    .returning();

  const admin = await makeUser(suffix, "admin", "super_admin");
  const manager = await makeUser(suffix, "manager", "hiring_manager");
  const interviewer = await makeUser(suffix, "interviewer", "interviewer");

  const jobA = await makeJob(suffix, "alpha", dept!.id, admin.id);
  const jobB = await makeJob(suffix, "bravo", dept!.id, admin.id);

  await db.insert(jobHiringTeam).values([
    { jobId: jobA.id, userId: manager.id },
    { jobId: jobA.id, userId: interviewer.id },
    { jobId: jobB.id, userId: manager.id },
  ]);

  const insertedCandidates = await db
    .insert(candidates)
    .values([
      {
        firstName: "Ada",
        lastName: "Alpha",
        email: `ada.${suffix}@example.test`,
        jobId: jobA.id,
        currentStageId: jobA.stageIds[0]!,
        status: "active",
      },
      {
        firstName: "Alan",
        lastName: "Alpha",
        email: `alan.${suffix}@example.test`,
        jobId: jobA.id,
        currentStageId: jobA.stageIds[1]!,
        status: "rejected",
      },
      {
        firstName: "Grace",
        lastName: "Bravo",
        email: `grace.${suffix}@example.test`,
        jobId: jobB.id,
        currentStageId: jobB.stageIds[0]!,
        status: "active",
      },
    ])
    .returning({ id: candidates.id });

  const [candidateA1, candidateA2, candidateB1] = insertedCandidates.map(
    (c) => c.id,
  ) as [number, number, number];

  const insertedOffers = await db
    .insert(offers)
    .values([
      {
        candidateId: candidateA1,
        jobId: jobA.id,
        createdBy: admin.id,
        status: "draft",
        salary: 100000,
        currency: "USD",
      },
      {
        candidateId: candidateB1,
        jobId: jobB.id,
        createdBy: admin.id,
        status: "sent",
        salary: 120000,
        currency: "USD",
      },
    ])
    .returning({ id: offers.id });

  const insertedInterviews = await db
    .insert(candidateInterviews)
    .values([
      {
        candidateId: candidateA1,
        jobId: jobA.id,
        stageId: jobA.stageIds[1]!,
        eventName: "Alpha screen",
        interviewerId: interviewer.id,
      },
      {
        candidateId: candidateB1,
        jobId: jobB.id,
        stageId: jobB.stageIds[1]!,
        eventName: "Bravo screen",
        interviewerId: manager.id,
      },
    ])
    .returning({ id: candidateInterviews.id });

  const [assessment] = await db
    .insert(assessments)
    .values({
      title: `Assessment ${suffix}`,
      timeLimit: 30,
      createdBy: admin.id,
    })
    .returning({ id: assessments.id });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const insertedAttempts = await db
    .insert(candidateAssessmentAttempts)
    .values([
      {
        candidateId: candidateA1,
        assessmentId: assessment!.id,
        token: `token-a1-${suffix}`,
        expiresAt,
      },
      {
        candidateId: candidateB1,
        assessmentId: assessment!.id,
        token: `token-b1-${suffix}`,
        expiresAt,
      },
    ])
    .returning({ id: candidateAssessmentAttempts.id });

  return {
    suffix,
    companyId: co!.id,
    departmentId: dept!.id,
    admin,
    manager,
    interviewer,
    jobA,
    jobB,
    candidateA1,
    candidateA2,
    candidateB1,
    offerA1: insertedOffers[0]!.id,
    offerB1: insertedOffers[1]!.id,
    interviewA1: insertedInterviews[0]!.id,
    interviewB1: insertedInterviews[1]!.id,
    assessmentId: assessment!.id,
    attemptA1: insertedAttempts[0]!.id,
    attemptB1: insertedAttempts[1]!.id,
  };
}

export async function destroyScenario(s: Scenario): Promise<void> {
  const jobIds = [s.jobA.id, s.jobB.id];
  const candidateIds = [s.candidateA1, s.candidateA2, s.candidateB1];
  const userIds = [s.admin.id, s.manager.id, s.interviewer.id];

  // Ordered by foreign key, not by convenience: candidates and offers hold
  // onDelete: "restrict" references to jobs.
  await db
    .delete(candidateAssessmentAttempts)
    .where(inArray(candidateAssessmentAttempts.candidateId, candidateIds));
  await db.delete(assessments).where(eq(assessments.id, s.assessmentId));
  await db
    .delete(candidateInterviews)
    .where(inArray(candidateInterviews.candidateId, candidateIds));
  await db.delete(offers).where(inArray(offers.candidateId, candidateIds));
  await db.delete(candidates).where(inArray(candidates.id, candidateIds));
  await db.delete(jobSkills).where(inArray(jobSkills.jobId, jobIds));
  await db.delete(jobHiringTeam).where(inArray(jobHiringTeam.jobId, jobIds));
  await db
    .delete(jobPipelineStages)
    .where(inArray(jobPipelineStages.jobId, jobIds));
  await db.delete(jobs).where(inArray(jobs.id, jobIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.delete(departments).where(eq(departments.id, s.departmentId));
  await db.delete(company).where(eq(company.id, s.companyId));
}

/**
 * A sorted list of the key paths in a value, descending into objects and the
 * first element of arrays.
 *
 * Characterization tests care about shape more than content: ids and
 * timestamps differ every run, but a rewrite that quietly stops returning
 * `skills` or renames `scorePercentage` is exactly what must not pass
 * unnoticed. Comparing key paths catches that and ignores the noise.
 */
export function shape(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.length === 0
      ? [`${prefix}[]`]
      : shape(value[0], `${prefix}[]`);
  }

  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .flatMap((key) => shape(record[key], prefix ? `${prefix}.${key}` : key))
      .sort();
  }

  return [prefix];
}

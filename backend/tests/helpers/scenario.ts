import { it } from "vitest";
import { Client } from "pg";
import { eq, inArray } from "drizzle-orm";
import { db, runInOrganization } from "../../src/db";
import { company, departments } from "../../src/db/schema/company";
import { jobs, jobSkills } from "../../src/db/schema/jobs";
import { clientCompanies } from "../../src/db/schema/organizations";
import { applications } from "../../src/db/schema/candidates";
import { jobHiringTeam, jobPipelineStages } from "../../src/db/schema/pipeline";
import {
  candidateAssessmentAttempts,
  candidates,
} from "../../src/db/schema/candidates";
import { assessments } from "../../src/db/schema/assessments";
import { candidateInterviews } from "../../src/db/schema/interviews";
import { offers } from "../../src/db/schema/offers";
import { users } from "../../src/db/schema/users";
import { organizationMembers } from "../../src/db/schema/organizations";
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
  /** The tenant every row below belongs to. */
  organizationId: number;
  /** The company the scenario's jobs are being filled for. */
  clientCompanyId: number;
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
  /** The people behind those submissions. */
  personA1: number;
  personA2: number;
  personB1: number;
  offerA1: number;
  offerB1: number;
  interviewA1: number;
  interviewB1: number;
  assessmentId: number;
  attemptA1: number;
  attemptB1: number;
}

let counter = 0;

// The organization the current file's fixtures live in. `itInOrg` reads it so
// individual tests do not have to thread it through.
let activeOrganizationId: number | null = null;

export function currentOrganization(): number {
  if (activeOrganizationId === null) {
    throw new Error("createScenario() must run before currentOrganization()");
  }
  return activeOrganizationId;
}

/**
 * `it`, with the body running under the scenario's organization.
 *
 * Every query now goes through a row-level-security policy that reads the
 * organization from the connection, so a test that does not establish one sees
 * an empty database. This is the whole of what a test file needs to change.
 */
export function itInOrg(name: string, fn: () => Promise<void>) {
  return it(name, () => runInOrganization(currentOrganization(), fn));
}

/**
 * Organizations cannot be created through the application role — their policy
 * is `WITH CHECK (id = app_current_org())`, so no tenant can bring another
 * into existence. Provisioning is a platform operation, so the fixtures reach
 * for an owner connection exactly once, to create the tenant they then work
 * inside.
 */
export async function createTestOrganization(suffix: string): Promise<number> {
  const id = await createOrganization(suffix);
  activeOrganizationId = id;
  return id;
}

export async function dropTestOrganization(id: number): Promise<void> {
  await dropOrganization(id);
  activeOrganizationId = null;
}

async function createOrganization(suffix: string): Promise<number> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error("MIGRATION_DATABASE_URL is required to create fixtures");
  }

  const owner = new Client({ connectionString: url });
  await owner.connect();
  try {
    const result = await owner.query<{ id: number }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [`Org ${suffix}`, suffix],
    );
    return result.rows[0]!.id;
  } finally {
    await owner.end();
  }
}

async function dropOrganization(organizationId: number): Promise<void> {
  const owner = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await owner.connect();
  try {
    await owner.query("DELETE FROM organizations WHERE id = $1", [
      organizationId,
    ]);
  } finally {
    await owner.end();
  }
}

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
  return {
    ...row!,
    role,
    organizationId: currentOrganization(),
    clientCompanyId: null,
  };
}

async function makeJob(
  suffix: string,
  tag: string,
  departmentId: number,
  createdBy: number,
  createdAt: Date,
  clientCompanyId: number,
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
      createdAt,
      clientCompanyId,
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
  const organizationId = await createOrganization(suffix);
  activeOrganizationId = organizationId;

  return runInOrganization(organizationId, () => buildScenario(suffix, organizationId));
}

async function buildScenario(
  suffix: string,
  organizationId: number,
): Promise<Scenario> {
  // Jobs belong to a client company now, so the scenario needs one.
  const [client] = await db
    .insert(clientCompanies)
    .values({ organizationId, name: `Client ${suffix}`, slug: suffix })
    .returning({ id: clientCompanies.id });
  const clientCompanyId = client!.id;

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

  // A user row is invisible until a membership places it in this organization.
  await db.insert(organizationMembers).values([
    { organizationId, userId: admin.id, role: "agency_owner" },
    { organizationId, userId: manager.id, role: "recruiter" },
    { organizationId, userId: interviewer.id, role: "interviewer" },
  ]);

  // Distinct timestamps: everything below runs in one transaction, so
  // defaultNow() would give both jobs the same value and any ordering
  // assertion would be a coin toss.
  const jobA = await makeJob(
    suffix, "alpha", dept!.id, admin.id, new Date("2026-01-01T00:00:00Z"), clientCompanyId,
  );
  const jobB = await makeJob(
    suffix, "bravo", dept!.id, admin.id, new Date("2026-02-01T00:00:00Z"), clientCompanyId,
  );

  await db.insert(jobHiringTeam).values([
    { jobId: jobA.id, userId: manager.id },
    { jobId: jobA.id, userId: interviewer.id },
    { jobId: jobB.id, userId: manager.id },
  ]);

  // Advance the candidates sequence so person ids and application ids cannot
  // line up. On a fresh database they do, and then a test that passes one
  // where the other belongs succeeds by coincidence — which is how a real bug
  // reached main. Cheap here, and it makes every id assertion in these suites
  // mean something.
  const [nudge] = await db
    .insert(candidates)
    .values({
      firstName: "Sequence",
      lastName: "Nudge",
      email: `nudge.${suffix}@example.test`,
    })
    .returning({ id: candidates.id });
  await db.delete(candidates).where(eq(candidates.id, nudge!.id));

  const insertedPeople = await db
    .insert(candidates)
    .values([
      { firstName: "Ada", lastName: "Alpha", email: `ada.${suffix}@example.test` },
      { firstName: "Alan", lastName: "Alpha", email: `alan.${suffix}@example.test` },
      { firstName: "Grace", lastName: "Bravo", email: `grace.${suffix}@example.test` },
    ])
    .returning({ id: candidates.id });

  // The scenario's "candidates" are submissions — that is what the dashboard
  // lists and what every test here means by a candidate.
  const insertedCandidates = await db
    .insert(applications)
    .values([
      {
        candidateId: insertedPeople[0]!.id,
        jobId: jobA.id,
        currentStageId: jobA.stageIds[0]!,
        status: "active",
      },
      {
        candidateId: insertedPeople[1]!.id,
        jobId: jobA.id,
        currentStageId: jobA.stageIds[1]!,
        status: "rejected",
      },
      {
        candidateId: insertedPeople[2]!.id,
        jobId: jobB.id,
        currentStageId: jobB.stageIds[0]!,
        status: "active",
      },
    ])
    .returning({ id: applications.id });

  const [candidateA1, candidateA2, candidateB1] = insertedCandidates.map(
    (c) => c.id,
  ) as [number, number, number];

  // Offers, interviews and CV analysis reference the person; everything the
  // dashboard calls a candidate is the submission above.
  const [personA1, personA2, personB1] = insertedPeople.map((p) => p.id) as [
    number,
    number,
    number,
  ];

  const insertedOffers = await db
    .insert(offers)
    .values([
      {
        candidateId: personA1,
        jobId: jobA.id,
        createdBy: admin.id,
        status: "draft",
        salary: 100000,
        currency: "USD",
      },
      {
        candidateId: personB1,
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
        candidateId: personA1,
        jobId: jobA.id,
        stageId: jobA.stageIds[1]!,
        eventName: "Alpha screen",
        interviewerId: interviewer.id,
      },
      {
        candidateId: personB1,
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
        applicationId: candidateA1,
        assessmentId: assessment!.id,
        token: `token-a1-${suffix}`,
        expiresAt,
      },
      {
        applicationId: candidateB1,
        assessmentId: assessment!.id,
        token: `token-b1-${suffix}`,
        expiresAt,
      },
    ])
    .returning({ id: candidateAssessmentAttempts.id });

  return {
    suffix,
    organizationId,
    clientCompanyId,
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
    personA1,
    personA2,
    personB1,
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
  await runInOrganization(s.organizationId, () => teardown(s));
  await dropOrganization(s.organizationId);
  activeOrganizationId = null;
}

async function teardown(s: Scenario): Promise<void> {
  const jobIds = [s.jobA.id, s.jobB.id];
  const candidateIds = [s.candidateA1, s.candidateA2, s.candidateB1];
  const personIds = [s.personA1, s.personA2, s.personB1];
  const userIds = [s.admin.id, s.manager.id, s.interviewer.id];

  // Ordered by foreign key, not by convenience: candidates and offers hold
  // onDelete: "restrict" references to jobs.
  await db
    .delete(candidateAssessmentAttempts)
    .where(inArray(candidateAssessmentAttempts.applicationId, candidateIds));
  await db.delete(assessments).where(eq(assessments.id, s.assessmentId));
  await db
    .delete(candidateInterviews)
    .where(inArray(candidateInterviews.candidateId, personIds));
  await db.delete(offers).where(inArray(offers.candidateId, personIds));
  await db
    .delete(applications)
    .where(inArray(applications.id, candidateIds));
  await db
    .delete(candidates)
    .where(eq(candidates.organizationId, s.organizationId));
  await db.delete(jobSkills).where(inArray(jobSkills.jobId, jobIds));
  await db.delete(jobHiringTeam).where(inArray(jobHiringTeam.jobId, jobIds));
  await db
    .delete(jobPipelineStages)
    .where(inArray(jobPipelineStages.jobId, jobIds));
  await db.delete(jobs).where(inArray(jobs.id, jobIds));
  await db
    .delete(clientCompanies)
    .where(eq(clientCompanies.id, s.clientCompanyId));
  await db
    .delete(organizationMembers)
    .where(inArray(organizationMembers.userId, userIds));
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

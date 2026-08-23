import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { jobHiringTeam } from "../../db/schema/pipeline";
import {
  applications,
  candidateAssessmentAttempts,
} from "../../db/schema/candidates";
import { candidateInterviews } from "../../db/schema/interviews";
import { offers } from "../../db/schema/offers";
import { jobs } from "../../db/schema/jobs";
import type { AuthenticatedUser } from "./verify-token";

// Per-job authorization, shared by the sockets and the HTTP middleware.
//
// Two rules live here and they are deliberately different:
//
//   canAccess*  — hiring-team membership, super_admin exempt. Used for the
//                 chat rooms and their socket equivalents, where the point is
//                 that a conversation belongs to the team having it.
//
//   canRead*    — record visibility, super_admin AND hiring_manager exempt.
//                 Used for reads of jobs, candidates, offers, and interviews.
//
// The split is not an accident. The list endpoints already narrow results with
// `teamUserId: req.user.role === "interviewer" ? req.user.id : undefined`, so
// only interviewers are team-scoped for record data; managers are company-wide
// by design. Applying the stricter rule to record reads would lock a
// hiring_manager out of jobs their own list endpoint shows them.

// Narrows an untrusted client-supplied id to a usable row id.
export function parseRoomId(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
  return id;
}

async function isOnHiringTeam(userId: number, jobId: number): Promise<boolean> {
  const [member] = await db
    .select({ id: jobHiringTeam.id })
    .from(jobHiringTeam)
    .where(and(eq(jobHiringTeam.jobId, jobId), eq(jobHiringTeam.userId, userId)))
    .limit(1);

  return !!member;
}

export async function canAccessJob(
  user: AuthenticatedUser,
  jobId: number,
): Promise<boolean> {
  // Admins manage hiring teams, so requiring membership would lock them out.
  if (user.role === "super_admin") return true;

  return isOnHiringTeam(user.id, jobId);
}

// A candidate belongs to one job, so access follows that job.
export async function canAccessCandidate(
  user: AuthenticatedUser,
  applicationId: number,
): Promise<boolean> {
  if (user.role === "super_admin") return true;

  const jobId = await jobIdForCandidate(applicationId);
  if (jobId === null) return false;

  return canAccessJob(user, jobId);
}

/**
 * Whether this user's view of records is confined to the jobs they are on the
 * hiring team for. Only `interviewer` is; see the note at the top of the file.
 */
export function isTeamScoped(user: AuthenticatedUser): boolean {
  return user.role === "interviewer";
}

/**
 * Whether this user is a contact at a client company rather than agency staff.
 *
 * Their organization already isolates them from other agencies. This is the
 * second boundary: within one agency, a client sees only their own company's
 * work, never the agency's other clients.
 *
 * Keyed on the membership rather than the role, because a role claim alone
 * cannot say *which* company — and a client user without one would otherwise
 * read as agency staff.
 */
export function isClientScoped(user: AuthenticatedUser): boolean {
  return user.clientCompanyId !== null;
}

/**
 * How a list should be narrowed for this user.
 *
 * Every list endpoint asks the same question and used to answer it inline,
 * which is how a new kind of user gets missed: a client contact with neither
 * filter set sees the agency's whole book of business.
 */
export function listScopeFor(user: AuthenticatedUser): {
  teamUserId?: number;
  clientCompanyId?: number;
} {
  if (isClientScoped(user)) {
    return { clientCompanyId: user.clientCompanyId! };
  }
  if (isTeamScoped(user)) return { teamUserId: user.id };
  return {};
}

/** The client company a job is being filled for. */
async function clientCompanyForJob(jobId: number): Promise<number | null> {
  const [row] = await db
    .select({ clientCompanyId: jobs.clientCompanyId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  return row?.clientCompanyId ?? null;
}

// ── Resolvers: map a record id to the job that owns it ──────────────────────
//
// Each returns null when the record does not exist, which the callers below
// turn into a denial rather than a 404. Telling an interviewer apart "this
// offer is not yours" from "this offer does not exist" would leak which ids
// are real.

/**
 * The job a candidate route is about.
 *
 * `:id` on these routes is an application id, not a person id — the dashboard
 * lists submissions and links to them, and a person has no single job to check
 * against. The application names its job directly.
 */
async function jobIdForCandidate(applicationId: number): Promise<number | null> {
  const [row] = await db
    .select({ jobId: applications.jobId })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);

  return row?.jobId ?? null;
}

async function jobIdForOffer(offerId: number): Promise<number | null> {
  const [row] = await db
    .select({ jobId: offers.jobId })
    .from(offers)
    .where(eq(offers.id, offerId))
    .limit(1);

  return row?.jobId ?? null;
}

async function jobIdForInterview(interviewId: number): Promise<number | null> {
  const [row] = await db
    .select({ jobId: candidateInterviews.jobId })
    .from(candidateInterviews)
    .where(eq(candidateInterviews.id, interviewId))
    .limit(1);

  return row?.jobId ?? null;
}

// An attempt points at a candidate, and the candidate points at the job.
// An attempt belongs to a submission, which names its job directly.
async function jobIdForAttempt(attemptId: number): Promise<number | null> {
  const [row] = await db
    .select({ jobId: applications.jobId })
    .from(candidateAssessmentAttempts)
    .innerJoin(
      applications,
      eq(candidateAssessmentAttempts.applicationId, applications.id),
    )
    .where(eq(candidateAssessmentAttempts.id, attemptId))
    .limit(1);

  return row?.jobId ?? null;
}

async function jobIdForSlug(slug: string): Promise<number | null> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.slug, slug))
    .limit(1);

  return row?.id ?? null;
}

// ── Read rules ─────────────────────────────────────────────────────────────

export async function canReadJob(
  user: AuthenticatedUser,
  jobId: number,
): Promise<boolean> {
  if (isClientScoped(user)) {
    return (await clientCompanyForJob(jobId)) === user.clientCompanyId;
  }
  if (!isTeamScoped(user)) return true;
  return isOnHiringTeam(user.id, jobId);
}

async function canReadVia(
  user: AuthenticatedUser,
  resolve: () => Promise<number | null>,
): Promise<boolean> {
  // Resolve nothing for unrestricted roles — saves a query on every request
  // made by the users who make most of them.
  if (!isClientScoped(user) && !isTeamScoped(user)) return true;

  const jobId = await resolve();
  if (jobId === null) return false;

  return canReadJob(user, jobId);
}

export function canReadCandidate(
  user: AuthenticatedUser,
  applicationId: number,
): Promise<boolean> {
  return canReadVia(user, () => jobIdForCandidate(applicationId));
}

export function canReadOffer(
  user: AuthenticatedUser,
  offerId: number,
): Promise<boolean> {
  return canReadVia(user, () => jobIdForOffer(offerId));
}

export function canReadInterview(
  user: AuthenticatedUser,
  interviewId: number,
): Promise<boolean> {
  return canReadVia(user, () => jobIdForInterview(interviewId));
}

export function canReadAttempt(
  user: AuthenticatedUser,
  attemptId: number,
): Promise<boolean> {
  return canReadVia(user, () => jobIdForAttempt(attemptId));
}

export function canReadJobSlug(
  user: AuthenticatedUser,
  slug: string,
): Promise<boolean> {
  return canReadVia(user, () => jobIdForSlug(slug));
}

import { eq, and, desc, asc, inArray, ilike, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  applications,
  type Application,
  type Candidate,
  candidates,
  candidateCvAnalysis,
  candidateStageHistory,
  candidateCustomAnswers,
  candidateCustomAnswerSelections,
  jobPipelineStages,
  jobCustomQuestions,
  jobCustomQuestionOptions,
  jobAssessmentAttachments,
  jobHiringTeam,
  jobs,
  offers,
  candidateRejections,
  candidateInterviews,
  company,
} from "../../db/schema";
import { assessmentExecutionService } from "../assessment-execution/assessment-execution.service";
import { candidateActivityService } from "./candidate-activity.service";
import { socketService } from "../../shared/services/socket.service";
import { rejectionService } from "../rejection/rejection.service";
import { mailService } from "../../shared/services/mail.service";
import { cleanObject as clean } from "../../utils/object.utils";
import logger from "../../utils/logger";

/** Drizzle wraps driver errors; Postgres code 23505 is often on `cause`. */
function isPgUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  const seen = new Set<unknown>();
  for (
    let depth = 0;
    depth < 12 && current && typeof current === "object";
    depth++
  ) {
    if (seen.has(current)) break;
    seen.add(current);
    const code = (current as { code?: string }).code;
    if (code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class DuplicateApplicationError extends Error {
  constructor() {
    super("DUPLICATE_APPLICATION");
    this.name = "DuplicateApplicationError";
  }
}

export interface CustomAnswerInput {
  questionId: number;
  answerText?: string | null | undefined;
  optionIds?: number[] | undefined;
}

export interface CandidateApplyInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null | undefined;
  resumeUrl?: string | null | undefined;
  customAnswers?: CustomAnswerInput[] | undefined;
}

export interface CandidateFilters {
  stageId?: number | undefined;
  search?: string | undefined;
  status?:
    | "active"
    | "rejected"
    | "offered"
    | "hired"
    | "withdrawn"
    | undefined;
  page?: number;
  limit?: number;
  teamUserId?: number;
}

export interface CandidateBasicUpdateInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  resumeUrl?: string | null;
}

function buildCandidateWhere(
  jobId: number | undefined,
  filters: Omit<CandidateFilters, "page" | "limit">,
) {
  const conditions = [];
  // The dashboard's "candidates" list is really a list of submissions: a
  // person appears once per job they are up for, with that job's stage and
  // status. Those columns live on `applications` now.
  if (jobId) conditions.push(eq(applications.jobId, jobId));
  if (filters.stageId)
    conditions.push(eq(applications.currentStageId, filters.stageId));
  if (filters.status) conditions.push(eq(applications.status, filters.status));
  if (filters.search) {
    conditions.push(
      or(
        ilike(candidates.firstName, `%${filters.search}%`),
        ilike(candidates.lastName, `%${filters.search}%`),
        ilike(candidates.email, `%${filters.search}%`),
      ),
    );
  }
  if (filters.teamUserId) {
    conditions.push(
      inArray(
        applications.jobId,
        db.select({ id: jobHiringTeam.jobId }).from(jobHiringTeam).where(eq(jobHiringTeam.userId, filters.teamUserId)),
      ),
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Returned with move-stage so the UI can toast automation outcomes. */
export type StageAutomationFlags = {
  assessmentInvite?: "sent" | "skipped_active_invite";
};

export type MoveStageResult = {
  /** The submission that moved, not the person. */
  candidate: Application;
  stageAutomation: StageAutomationFlags;
};

async function sendApplicationConfirmationEmail(
  candidate: Candidate,
  jobId: number,
) {
  try {
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) return;

    const [comp] = await db.select().from(company).limit(1);
    const companyName = comp?.name ?? "Talent Acquisition Team";

    const candidateName = `${candidate.firstName} ${candidate.lastName}`;
    const subject = `${job.title} - Thank you for your application`;
    const html = `
      <div style="font-family:sans-serif;line-height:1.8;color:#333;max-width:600px">
        <p>Dear ${candidateName},</p>
        <p>We have successfully received your application and will review it carefully.</p>
        <p>If your qualifications align with our requirements, we'll be in touch regarding the next steps. We appreciate your interest in joining our team.</p>
        <br>
        <p>Regards,<br>${companyName} Talent Acquisition Team</p>
      </div>
    `;

    await mailService.sendEmail({ to: candidate.email, subject, html });
  } catch (err) {
    logger.error("Failed to send application confirmation email:", err);
  }
}

export const candidateService = {
  async apply(jobId: number, input: CandidateApplyInput) {
    const { customAnswers, ...rest } = input;
    const normalizedEmail = rest.email.trim().toLowerCase();
    const candidateData = { ...rest, email: normalizedEmail };

    try {
      return await db.transaction(async (tx) => {
        const [firstStage] = await tx
          .select()
          .from(jobPipelineStages)
          .where(eq(jobPipelineStages.jobId, jobId))
          .orderBy(asc(jobPipelineStages.position))
          .limit(1);

        if (!firstStage) {
          throw new Error("No pipeline stages defined for this job");
        }

        // The person may already be known to this agency from another role.
        // Applying again updates their details and adds a submission rather
        // than creating a second person.
        const [candidate] = await tx
          .insert(candidates)
          .values(clean(candidateData))
          .onConflictDoUpdate({
            target: [candidates.organizationId, candidates.email],
            set: clean({ ...candidateData, updatedAt: new Date() }),
          })
          .returning();

        if (!candidate) {
          throw new Error("Failed to create candidate");
        }

        const [application] = await tx
          .insert(applications)
          .values({
            candidateId: candidate.id,
            jobId,
            currentStageId: firstStage.id,
          })
          .returning();

        if (!application) {
          throw new Error("Failed to create application");
        }

        await tx.insert(candidateStageHistory).values({
          applicationId: application.id,
          stageId: firstStage.id,
        });

        if (customAnswers && customAnswers.length > 0) {
          for (const answer of customAnswers) {
            const [question] = await tx
              .select()
              .from(jobCustomQuestions)
              .where(
                and(
                  eq(jobCustomQuestions.id, answer.questionId),
                  eq(jobCustomQuestions.jobId, jobId),
                ),
              );

            if (!question) continue;

            if (answer.answerText !== undefined) {
              await tx.insert(candidateCustomAnswers).values({
                applicationId: application.id,
                questionId: answer.questionId,
                answerText: answer.answerText,
              });
            }

            if (answer.optionIds && answer.optionIds.length > 0) {
              await tx.insert(candidateCustomAnswerSelections).values(
                answer.optionIds.map((optionId) => ({
                  applicationId: application.id,
                  questionId: answer.questionId,
                  optionId,
                })),
              );
            }
          }
        }

        // `id` is the submission, matching what every other candidate route
        // means by an id. The person is still there as candidateId.
        return { ...candidate, id: application.id, candidateId: candidate.id, jobId };
      }).then((candidate) => {
        socketService.notifyCandidateApplied(jobId);
        void sendApplicationConfirmationEmail(candidate, jobId);
        return candidate;
      });
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new DuplicateApplicationError();
      }
      throw err;
    }
  },

  async getAll(jobId: number | undefined, filters: CandidateFilters = {}) {
    const { page = 1, limit = 25, ...rest } = filters;
    const offset = (page - 1) * limit;

    const where = buildCandidateWhere(jobId, rest);

    const [rows, [countRow]] = await Promise.all([
      db
        .select({
          // The application id, not the person's. A row here is one
          // submission, and the same person can appear twice under different
          // jobs. Ids are opaque to the dashboard, so this keeps working.
          id: applications.id,
          candidateId: candidates.id,
          firstName: candidates.firstName,
          lastName: candidates.lastName,
          email: candidates.email,
          phone: candidates.phone,
          resumeUrl: candidates.resumeUrl,
          jobId: applications.jobId,
          currentStageId: applications.currentStageId,
          status: applications.status,
          appliedAt: applications.appliedAt,
          updatedAt: applications.updatedAt,
          stageName: jobPipelineStages.name,
          jobTitle: jobs.title,
        })
        .from(applications)
        .innerJoin(candidates, eq(applications.candidateId, candidates.id))
        .leftJoin(
          jobPipelineStages,
          eq(applications.currentStageId, jobPipelineStages.id),
        )
        .leftJoin(jobs, eq(applications.jobId, jobs.id))
        .where(where)
        .orderBy(desc(applications.appliedAt))
        .limit(limit)
        .offset(offset),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(applications)
        .innerJoin(candidates, eq(applications.candidateId, candidates.id))
        .where(where),
    ]);

    return {
      rows,
      total: countRow?.count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((countRow?.count ?? 0) / limit),
    };
  },

  /**
   * One submission, with the person attached.
   *
   * `id` is an application id — the detail page shows a person in the context
   * of the job they are up for, which is what it always showed. The person's
   * other applications hang off `candidateId`.
   */
  /** Every job this person is currently up for. */
  async applicationsFor(candidateId: number) {
    return db
      .select({ id: applications.id, jobId: applications.jobId })
      .from(applications)
      .where(eq(applications.candidateId, candidateId));
  },

  async getById(id: number) {
    const [candidate] = await db
      .select({
        id: applications.id,
        candidateId: candidates.id,
        firstName: candidates.firstName,
        lastName: candidates.lastName,
        email: candidates.email,
        phone: candidates.phone,
        resumeUrl: candidates.resumeUrl,
        jobId: applications.jobId,
        currentStageId: applications.currentStageId,
        status: applications.status,
        appliedAt: applications.appliedAt,
        updatedAt: applications.updatedAt,
        stageName: jobPipelineStages.name,
        jobTitle: jobs.title,
      })
      .from(applications)
      .innerJoin(candidates, eq(applications.candidateId, candidates.id))
      .leftJoin(
        jobPipelineStages,
        eq(applications.currentStageId, jobPipelineStages.id),
      )
      .leftJoin(jobs, eq(applications.jobId, jobs.id))
      .where(eq(applications.id, id));

    if (!candidate) return null;

    const answers = await db
      .select({
        id: candidateCustomAnswers.id,
        applicationId: candidateCustomAnswers.applicationId,
        questionId: candidateCustomAnswers.questionId,
        answerText: candidateCustomAnswers.answerText,
        createdAt: candidateCustomAnswers.createdAt,
        questionTitle: jobCustomQuestions.title,
      })
      .from(candidateCustomAnswers)
      .leftJoin(
        jobCustomQuestions,
        eq(candidateCustomAnswers.questionId, jobCustomQuestions.id),
      )
      .where(eq(candidateCustomAnswers.applicationId, id));

    const selections = await db
      .select({
        id: candidateCustomAnswerSelections.id,
        candidateId: candidateCustomAnswerSelections.applicationId,
        questionId: candidateCustomAnswerSelections.questionId,
        optionId: candidateCustomAnswerSelections.optionId,
        createdAt: candidateCustomAnswerSelections.createdAt,
        questionTitle: jobCustomQuestions.title,
        optionLabel: jobCustomQuestionOptions.label,
      })
      .from(candidateCustomAnswerSelections)
      .leftJoin(
        jobCustomQuestions,
        eq(candidateCustomAnswerSelections.questionId, jobCustomQuestions.id),
      )
      .leftJoin(
        jobCustomQuestionOptions,
        eq(
          candidateCustomAnswerSelections.optionId,
          jobCustomQuestionOptions.id,
        ),
      )
      .where(eq(candidateCustomAnswerSelections.applicationId, id));

    const history = await db
      .select()
      .from(candidateStageHistory)
      .where(eq(candidateStageHistory.applicationId, id))
      .orderBy(asc(candidateStageHistory.movedAt));

    const [offer] = await db
      .select()
      .from(offers)
      .where(
        and(
          eq(offers.candidateId, candidate.candidateId),
          eq(offers.jobId, candidate.jobId),
        ),
      );

    const [cvRow] = await db
      .select()
      .from(candidateCvAnalysis)
      .where(eq(candidateCvAnalysis.candidateId, id));

    const cvAnalysis = cvRow
      ? {
          status: cvRow.status,
          matchScore:
            cvRow.matchScore != null ? Number(cvRow.matchScore) : null,
          matchedSkills: cvRow.matchedSkills,
          missingSkills: cvRow.missingSkills,
          scoreBreakdown: cvRow.scoreBreakdown,
          aiSummary: cvRow.aiSummary ?? null,
          errorMessage: cvRow.errorMessage,
          updatedAt: cvRow.updatedAt,
        }
      : null;

    const rejections = await db
      .select()
      .from(candidateRejections)
      .where(eq(candidateRejections.candidateId, id))
      .orderBy(desc(candidateRejections.rejectedAt));

    const interviews = await db
      .select({
        id: candidateInterviews.id,
        candidateId: candidateInterviews.candidateId,
        stageId: candidateInterviews.stageId,
        jobId: candidateInterviews.jobId,
        scheduledAt: candidateInterviews.scheduledAt,
        durationMinutes: candidateInterviews.durationMinutes,
        notes: candidateInterviews.notes,
        outcome: candidateInterviews.outcome,
        status: candidateInterviews.status,
        eventName: candidateInterviews.eventName,
        eventType: candidateInterviews.eventType,
        meetingUrl: candidateInterviews.meetingUrl,
        bodyText: candidateInterviews.bodyText,
        timeSlots: candidateInterviews.timeSlots,
        publicToken: candidateInterviews.publicToken,
        googleEventId: candidateInterviews.googleEventId,
        createdBy: candidateInterviews.createdBy,
        createdAt: candidateInterviews.createdAt,
        updatedAt: candidateInterviews.updatedAt,
        stageType: jobPipelineStages.stageType,
      })
      .from(candidateInterviews)
      .leftJoin(
        jobPipelineStages,
        eq(candidateInterviews.stageId, jobPipelineStages.id),
      )
      .where(
        and(
          eq(candidateInterviews.candidateId, candidate.candidateId),
          eq(candidateInterviews.jobId, candidate.jobId),
        ),
      )
      .orderBy(desc(candidateInterviews.createdAt));

    const activities = await candidateActivityService.getByCandidate(id);

    return {
      ...candidate,
      answers,
      selections,
      history,
      offer: offer ?? null,
      cvAnalysis,
      rejections,
      interviews,
      activities,
    };
  },

  async moveStage(
    applicationId: number,
    newStageId: number,
    movedBy: number | null = null,
  ): Promise<MoveStageResult> {
    return await db.transaction(async (tx) => {
      const stageAutomation: StageAutomationFlags = {};

      const [candidate] = await tx
        .select()
        .from(applications)
        .where(eq(applications.id, applicationId));

      // `candidateId` here is an application id — moving a stage moves one
      // submission, not the person, who may be at a different stage elsewhere.
      if (!candidate) throw new Error("Application not found");

      const [stage] = await tx
        .select()
        .from(jobPipelineStages)
        .where(
          and(
            eq(jobPipelineStages.id, newStageId),
            eq(jobPipelineStages.jobId, candidate.jobId),
          ),
        );

      if (!stage) throw new Error("Invalid stage for this job");

      // Already in this stage — skip duplicate history and automations
      if (candidate.currentStageId === newStageId) {
        return { candidate, stageAutomation };
      }

      const nextStatus =
        candidate.status === "rejected" || candidate.status === "hired"
          ? candidate.status
          : stage.stageType === "offer"
            ? "offered"
            : "active";

      const [updated] = await tx
        .update(applications)
        .set({
          currentStageId: newStageId,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(applications.id, applicationId))
        .returning();

      if (!updated) throw new Error("Failed to update application");

      await tx.insert(candidateStageHistory).values({
        applicationId,
        stageId: newStageId,
        movedBy,
      });

      if (stage.stageType === "offer") {
        const [existingOffer] = await tx
          .select()
          .from(offers)
          .where(
            and(
              eq(offers.candidateId, candidate.candidateId),
              eq(offers.jobId, candidate.jobId),
            ),
          )
          .limit(1);

        if (!existingOffer) {
          if (!movedBy) {
            throw new Error("Unable to auto-create offer without an actor");
          }

          const [createdOffer] = await tx
            .insert(offers)
            .values({
              // Offers store the person; jobId says which submission. Passing
              // the application id here attaches the offer to whichever
              // person shares that number.
              candidateId: candidate.candidateId,
              jobId: candidate.jobId,
              status: "draft",
              createdBy: movedBy,
            })
            .returning();

          if (createdOffer) {
            await candidateActivityService.create(
              {
                candidateId: candidate.candidateId,
                jobId: candidate.jobId,
                offerId: createdOffer.id,
                actorId: movedBy,
                eventType: "offer_created",
              },
              tx,
            );
          }
        }
      }

      // Assessment automation
      const [attachment] = await tx
        .select()
        .from(jobAssessmentAttachments)
        .where(
          and(
            eq(jobAssessmentAttachments.jobId, candidate.jobId),
            eq(jobAssessmentAttachments.triggerStageId, newStageId),
          ),
        );

      if (attachment) {
        const { didSendInvite } =
          await assessmentExecutionService.inviteCandidate(
            applicationId,
            attachment.assessmentId,
          );
        stageAutomation.assessmentInvite = didSendInvite
          ? "sent"
          : "skipped_active_invite";
      }

      return { candidate: updated, stageAutomation };
    });
  },

  async rejectCandidate(
    applicationId: number,
    input: {
      reason?: string | null;
      templateId?: number | null;
      emailStatus: "not_sent" | "draft" | "sent";
    },
    rejectedBy: number | null = null,
  ) {
    const [candidate] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId));

    if (!candidate) throw new Error("Application not found");

    return rejectionService.reject(
      {
        candidateId: candidate.candidateId,
        jobId: candidate.jobId,
        fromStageId: candidate.currentStageId,
        reason: input.reason ?? null,
        templateId: input.templateId ?? null,
        emailStatus: input.emailStatus,
      },
      rejectedBy,
    );
  },

  async updateBasicDetails(id: number, data: CandidateBasicUpdateInput) {
    const [existing] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, id))
      .limit(1);

    if (!existing) return null;

    const [updated] = await db
      .update(candidates)
      .set(
        clean({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          resumeUrl: data.resumeUrl,
          updatedAt: new Date(),
        }),
      )
      .where(eq(candidates.id, id))
      .returning();

    return updated ?? null;
  },

  async delete(id: number) {
    const [deleted] = await db
      .delete(candidates)
      .where(eq(candidates.id, id))
      .returning();
    return deleted ?? null;
  },

  async deleteManyByFilters(
    jobId: number | undefined,
    filters: Omit<CandidateFilters, "page" | "limit"> = {},
  ) {
    // Deleting from a job list removes those submissions. The people stay:
    // they belong to the agency and may be up for other roles.
    const ids = await db
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(candidates, eq(applications.candidateId, candidates.id))
      .where(buildCandidateWhere(jobId, filters));

    if (ids.length === 0) return [];

    const deleted = await db
      .delete(applications)
      .where(inArray(applications.id, ids.map((r) => r.id)))
      .returning({
        id: applications.id,
        candidateId: applications.candidateId,
        jobId: applications.jobId,
      });

    return deleted;
  },
};

//TODO: implement kafka

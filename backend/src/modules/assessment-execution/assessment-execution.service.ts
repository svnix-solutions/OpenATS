import { eq, and, or, gt, sql, desc } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../../db";
import {
  candidateAssessmentAttempts,
  candidateAssessmentAnswers,
  candidateAssessmentAnswerSelections,
  assessments,
  assessmentQuestions,
  assessmentQuestionOptions,
  applications,
  candidates,
} from "../../db/schema";

import { mailService } from "../../shared/services/mail.service";
import { assessmentUrl } from "../../shared/links";

export interface SubmitAnswerInput {
  questionId: number;
  answerText?: string | null | undefined;
  optionIds?: number[] | undefined;
}

export interface AttemptCompletionEmailContext {
  candidateEmail: string;
  candidateFirstName: string;
  assessmentTitle: string;
}

export type InviteCandidateResult = {
  attempt: typeof candidateAssessmentAttempts.$inferSelect | null;
  /** False when reusing an active attempt (no new email). */
  didSendInvite: boolean;
};

/**
 * Which question types are scored by comparing the options a candidate picked.
 *
 * Everything else is written prose, which nothing can mark automatically. The
 * two sets are defined here rather than listed twice, because a new choice
 * type added to only one of them would either score as prose or become
 * hand-scorable without anyone deciding that.
 */
const CHOICE_QUESTION_TYPES = [
  "multiple_choice",
  "radio",
  "checkbox",
] as const;

export function isChoiceQuestion(type: string): boolean {
  return (CHOICE_QUESTION_TYPES as readonly string[]).includes(type);
}

export const assessmentExecutionService = {
  async inviteCandidate(
    candidateId: number,
    assessmentId: number,
    expiryDays: number = 7,
  ): Promise<InviteCandidateResult> {
    const now = new Date();

    const [activeAttempt] = await db
      .select()
      .from(candidateAssessmentAttempts)
      .where(
        and(
          eq(candidateAssessmentAttempts.applicationId, candidateId),
          eq(candidateAssessmentAttempts.assessmentId, assessmentId),
          or(
            eq(candidateAssessmentAttempts.status, "started"),
            and(
              eq(candidateAssessmentAttempts.status, "pending"),
              gt(candidateAssessmentAttempts.expiresAt, now),
            ),
          ),
        ),
      )
      .orderBy(desc(candidateAssessmentAttempts.createdAt))
      .limit(1);

    if (activeAttempt) {
      return { attempt: activeAttempt, didSendInvite: false };
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const [attempt] = await db
      .insert(candidateAssessmentAttempts)
      .values({
        applicationId: candidateId,
        assessmentId,
        token,
        expiresAt,
        status: "pending",
      })
      .returning();

    let didSendInvite = false;

    if (attempt) {
      const [candidate] = await db
        .select()
        .from(candidates)
        .where(eq(candidates.id, candidateId));
      const [assessment] = await db
        .select()
        .from(assessments)
        .where(eq(assessments.id, assessmentId));

      if (candidate && assessment) {
        const inviteUrl = assessmentUrl(token);

        const subject = `Assessment Invitation: ${assessment.title}`;
        const html = `
          <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
            <h2>Hello ${candidate.firstName},</h2>
            <p>You have been invited to complete an assessment for your application.</p>
            <p><strong>Assessment:</strong> ${assessment.title}</p>
            <p>Please click the button below to start the assessment. This link will expire on ${expiresAt.toLocaleDateString()}.</p>
            <div style="margin: 24px 0;">
              <a href="${inviteUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                Start Assessment
              </a>
            </div>
            <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p><a href="${inviteUrl}">${inviteUrl}</a></p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 24px 0;">
            <p style="font-size: 14px; color: #666;">This is an automated message from OpenATS.</p>
          </div>
        `;

        await mailService.sendAssessmentInviteEmail(
          candidate.email,
          subject,
          html,
        );
        didSendInvite = true;
      }
    }

    return { attempt: attempt ?? null, didSendInvite };
  },

  async getAttemptsByCandidate(candidateId: number) {
    return db
      .select({
        id: candidateAssessmentAttempts.id,
        assessmentId: candidateAssessmentAttempts.assessmentId,
        token: candidateAssessmentAttempts.token,
        status: candidateAssessmentAttempts.status,
        expiresAt: candidateAssessmentAttempts.expiresAt,
        startedAt: candidateAssessmentAttempts.startedAt,
        completedAt: candidateAssessmentAttempts.completedAt,
        scorePercentage: candidateAssessmentAttempts.scorePercentage,
        passed: candidateAssessmentAttempts.passed,
        assessmentTitle: assessments.title,
      })
      .from(candidateAssessmentAttempts)
      .innerJoin(
        assessments,
        eq(candidateAssessmentAttempts.assessmentId, assessments.id),
      )
      .where(eq(candidateAssessmentAttempts.applicationId, candidateId))
      .orderBy(desc(candidateAssessmentAttempts.createdAt));
  },

  async getAttemptByToken(token: string) {
    const [attempt] = await db
      .select({
        id: candidateAssessmentAttempts.id,
        status: candidateAssessmentAttempts.status,
        expiresAt: candidateAssessmentAttempts.expiresAt,
        startedAt: candidateAssessmentAttempts.startedAt,
        completedAt: candidateAssessmentAttempts.completedAt,
        assessment: {
          id: assessments.id,
          title: assessments.title,
          description: assessments.description,
          timeLimit: assessments.timeLimit,
        },
        candidate: {
          id: candidates.id,
          firstName: candidates.firstName,
          lastName: candidates.lastName,
          email: candidates.email,
        },
      })
      .from(candidateAssessmentAttempts)
      .innerJoin(
        assessments,
        eq(candidateAssessmentAttempts.assessmentId, assessments.id),
      )
      .innerJoin(
        applications,
        eq(candidateAssessmentAttempts.applicationId, applications.id),
      )
      .innerJoin(candidates, eq(applications.candidateId, candidates.id))
      .where(eq(candidateAssessmentAttempts.token, token));

    if (!attempt) return null;

    // fetch questions (without isCorrect flags)
    const questions = await db
      .select({
        id: assessmentQuestions.id,
        title: assessmentQuestions.title,
        description: assessmentQuestions.description,
        questionType: assessmentQuestions.questionType,
        position: assessmentQuestions.position,
        points: assessmentQuestions.points,
      })
      .from(assessmentQuestions)
      .where(eq(assessmentQuestions.assessmentId, attempt.assessment.id))
      .orderBy(assessmentQuestions.position);

    const questionsWithOptions = await Promise.all(
      questions.map(async (q) => {
        const options = await db
          .select({
            id: assessmentQuestionOptions.id,
            label: assessmentQuestionOptions.label,
            position: assessmentQuestionOptions.position,
          })
          .from(assessmentQuestionOptions)
          .where(eq(assessmentQuestionOptions.questionId, q.id))
          .orderBy(assessmentQuestionOptions.position);

        return { ...q, options };
      }),
    );

    return {
      ...attempt,
      assessment: { ...attempt.assessment, questions: questionsWithOptions },
    };
  },

  async getAttemptCompletionEmailContext(attemptId: number): Promise<AttemptCompletionEmailContext | null> {
    const [result] = await db
      .select({
        candidateEmail: candidates.email,
        candidateFirstName: candidates.firstName,
        assessmentTitle: assessments.title,
      })
      .from(candidateAssessmentAttempts)
      .innerJoin(
        applications,
        eq(candidateAssessmentAttempts.applicationId, applications.id),
      )
      .innerJoin(candidates, eq(applications.candidateId, candidates.id))
      .innerJoin(
        assessments,
        eq(candidateAssessmentAttempts.assessmentId, assessments.id),
      )
      .where(eq(candidateAssessmentAttempts.id, attemptId));

    return result ?? null;
  },

  async startAttempt(id: number) {
    const [attempt] = await db
      .update(candidateAssessmentAttempts)
      .set({
        status: "started",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(candidateAssessmentAttempts.id, id),
          eq(candidateAssessmentAttempts.status, "pending"),
        ),
      )
      .returning();

    return attempt;
  },

  async saveAnswer(attemptId: number, input: SubmitAnswerInput) {
    return await db.transaction(async (tx) => {
      // 1. save or update answer
      const [answer] = await tx
        .insert(candidateAssessmentAnswers)
        .values({
          attemptId,
          questionId: input.questionId,
          answerText: input.answerText ?? null,
        })
        .onConflictDoUpdate({
          target: [
            candidateAssessmentAnswers.attemptId,
            candidateAssessmentAnswers.questionId,
          ],
          set: { answerText: input.answerText ?? null, updatedAt: new Date() },
        })
        .returning();

      if (!answer)
        throw new Error("Database failed to return the saved answer record.");

      // clear old selections and save new ones (for multiple choice)
      await tx
        .delete(candidateAssessmentAnswerSelections)
        .where(eq(candidateAssessmentAnswerSelections.answerId, answer.id));

      if (input.optionIds && input.optionIds.length > 0) {
        await tx.insert(candidateAssessmentAnswerSelections).values(
          input.optionIds.map((optionId) => ({
            answerId: answer.id,
            optionId,
          })),
        );
      }

      return answer;
    });
  },

  async completeAttempt(id: number) {
    return await db.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(candidateAssessmentAttempts)
        .where(eq(candidateAssessmentAttempts.id, id));

      if (!attempt || attempt.status !== "started") {
        throw new Error("Attempt is not in 'started' status");
      }

      const [assessment] = await tx
        .select()
        .from(assessments)
        .where(eq(assessments.id, attempt.assessmentId));

      if (!assessment) {
        throw new Error("Assessment not found");
      }

      const questions = await tx
        .select()
        .from(assessmentQuestions)
        .where(eq(assessmentQuestions.assessmentId, attempt.assessmentId));

      let totalScoreRaw = 0;
      let totalPossiblePoints = 0;

      for (const question of questions) {
        const questionPoints = Number(question.points);
        totalPossiblePoints += questionPoints;

        const [candidateAnswer] = await tx
          .select()
          .from(candidateAssessmentAnswers)
          .where(
            and(
              eq(candidateAssessmentAnswers.attemptId, id),
              eq(candidateAssessmentAnswers.questionId, question.id),
            ),
          );

        if (!candidateAnswer) continue;

        let pointsEarned = 0;

        if (isChoiceQuestion(question.questionType)) {
          const correctOptions = await tx
            .select()
            .from(assessmentQuestionOptions)
            .where(
              and(
                eq(assessmentQuestionOptions.questionId, question.id),
                eq(assessmentQuestionOptions.isCorrect, true),
              ),
            );

          const candidateSelections = await tx
            .select()
            .from(candidateAssessmentAnswerSelections)
            .where(
              eq(
                candidateAssessmentAnswerSelections.answerId,
                candidateAnswer.id,
              ),
            );

          const correctOptionIds = correctOptions.map((o) => o.id).sort();
          const candidateOptionIds = candidateSelections
            .map((s) => s.optionId)
            .sort();

          const isCorrect =
            JSON.stringify(correctOptionIds) ===
            JSON.stringify(candidateOptionIds);
          if (isCorrect) pointsEarned = questionPoints;
        } else {
          pointsEarned = 0;
        }

        await tx
          .update(candidateAssessmentAnswers)
          .set({ pointsEarned, updatedAt: new Date() })
          .where(eq(candidateAssessmentAnswers.id, candidateAnswer.id));

        totalScoreRaw += pointsEarned;
      }

      const scorePercentage =
        totalPossiblePoints > 0
          ? (totalScoreRaw / totalPossiblePoints) * 100
          : 0;

      const [completed] = await tx
        .update(candidateAssessmentAttempts)
        .set({
          status: "completed",
          completedAt: new Date(),
          scoreRaw: totalScoreRaw,
          scoreTotal: totalPossiblePoints,
          scorePercentage,
          passed: null,
          updatedAt: new Date(),
        })
        .where(eq(candidateAssessmentAttempts.id, id))
        .returning();

      return completed;
    });
  },

  async getAttemptResults(attemptId: number) {
    const [attempt] = await db
      .select({
        id: candidateAssessmentAttempts.id,
        candidateId: candidateAssessmentAttempts.applicationId,
        assessmentId: candidateAssessmentAttempts.assessmentId,
        status: candidateAssessmentAttempts.status,
        startedAt: candidateAssessmentAttempts.startedAt,
        completedAt: candidateAssessmentAttempts.completedAt,
        scoreRaw: candidateAssessmentAttempts.scoreRaw,
        scoreTotal: candidateAssessmentAttempts.scoreTotal,
        scorePercentage: candidateAssessmentAttempts.scorePercentage,
        passed: candidateAssessmentAttempts.passed,
        assessmentTitle: assessments.title,
        assessmentDescription: assessments.description,
        candidateName: sql<string>`concat(${candidates.firstName}, ' ', ${candidates.lastName})`,
        candidateEmail: candidates.email,
      })
      .from(candidateAssessmentAttempts)
      .innerJoin(assessments, eq(candidateAssessmentAttempts.assessmentId, assessments.id))
      .innerJoin(
        applications,
        eq(candidateAssessmentAttempts.applicationId, applications.id),
      )
      .innerJoin(candidates, eq(applications.candidateId, candidates.id))
      .where(eq(candidateAssessmentAttempts.id, attemptId));

    if (!attempt) return null;

    const questions = await db
      .select()
      .from(assessmentQuestions)
      .where(eq(assessmentQuestions.assessmentId, attempt.assessmentId))
      .orderBy(assessmentQuestions.position);

    const options = await db
      .select({
        id: assessmentQuestionOptions.id,
        questionId: assessmentQuestionOptions.questionId,
        label: assessmentQuestionOptions.label,
        isCorrect: assessmentQuestionOptions.isCorrect,
        position: assessmentQuestionOptions.position,
      })
      .from(assessmentQuestionOptions)
      .innerJoin(assessmentQuestions, eq(assessmentQuestionOptions.questionId, assessmentQuestions.id))
      .where(eq(assessmentQuestions.assessmentId, attempt.assessmentId))
      .orderBy(assessmentQuestionOptions.position);

    const answers = await db
      .select()
      .from(candidateAssessmentAnswers)
      .where(eq(candidateAssessmentAnswers.attemptId, attemptId));

    const selections = await db
      .select({
        answerId: candidateAssessmentAnswerSelections.answerId,
        optionId: candidateAssessmentAnswerSelections.optionId,
      })
      .from(candidateAssessmentAnswerSelections)
      .innerJoin(
        candidateAssessmentAnswers,
        eq(candidateAssessmentAnswerSelections.answerId, candidateAssessmentAnswers.id)
      )
      .where(eq(candidateAssessmentAnswers.attemptId, attemptId));

    const formattedQuestions = questions.map((q) => {
      const qOptions = options
        .filter((o) => o.questionId === q.id)
        .map((o) => ({
          id: o.id,
          label: o.label,
          isCorrect: o.isCorrect,
        }));

      const candAnswer = answers.find((ans) => ans.questionId === q.id);
      const candSelections = candAnswer
        ? selections
            .filter((sel) => sel.answerId === candAnswer.id)
            .map((sel) => sel.optionId)
        : [];

      return {
        id: q.id,
        title: q.title,
        description: q.description,
        questionType: q.questionType,
        points: q.points,
        position: q.position,
        options: qOptions,
        answer: candAnswer
          ? {
              // The id, so a written answer can be given a mark. Without it
              // the reviewer can read the answer and has nothing to act on.
              id: candAnswer.id,
              answerText: candAnswer.answerText,
              selectedOptionIds: candSelections,
              pointsEarned: candAnswer.pointsEarned,
            }
          : null,
      };
    });

    return {
      attempt,
      questions: formattedQuestions,
    };
  },

  /**
   * Awards points for one written answer, and re-totals the attempt.
   *
   * Short answers are scored 0 by `completeAttempt` — there is nothing to
   * compare them against — while still contributing their points to the
   * total. The builder has always told the author they are "reviewed manually
   * by the hiring team", and until now nothing could record that review: the
   * reviewer could read the answer and had no way to say what it was worth, so
   * an assessment containing one could never be scored above the fraction the
   * choice questions made up.
   *
   * Re-totalling here rather than in a separate step because a score and the
   * answers it came from must not be able to disagree. Both move together, in
   * one transaction.
   */
  async scoreWrittenAnswer(
    attemptId: number,
    answerId: number,
    pointsEarned: number,
  ) {
    return db.transaction(async (tx) => {
      const [answer] = await tx
        .select({
          id: candidateAssessmentAnswers.id,
          questionId: candidateAssessmentAnswers.questionId,
          questionType: assessmentQuestions.questionType,
          questionPoints: assessmentQuestions.points,
        })
        .from(candidateAssessmentAnswers)
        .innerJoin(
          assessmentQuestions,
          eq(assessmentQuestions.id, candidateAssessmentAnswers.questionId),
        )
        .where(
          and(
            eq(candidateAssessmentAnswers.id, answerId),
            eq(candidateAssessmentAnswers.attemptId, attemptId),
          ),
        );

      // Scoped to the attempt as well as the answer: an answer id from another
      // attempt is a valid id, and would otherwise be scored against this one.
      if (!answer) return { error: "not_found" as const };

      // Choice questions are scored by comparing selections. Letting a person
      // overwrite that would make the score untraceable to the answers.
      if (isChoiceQuestion(answer.questionType)) {
        return { error: "not_written" as const };
      }

      const max = Number(answer.questionPoints);
      if (pointsEarned > max) {
        return { error: "over_max" as const, max };
      }

      await tx
        .update(candidateAssessmentAnswers)
        .set({ pointsEarned, updatedAt: new Date() })
        .where(eq(candidateAssessmentAnswers.id, answerId));

      // Re-add from the answers themselves rather than adjusting the stored
      // total by a delta: a delta drifts the moment anything else writes.
      const scored = await tx
        .select({ pointsEarned: candidateAssessmentAnswers.pointsEarned })
        .from(candidateAssessmentAnswers)
        .where(eq(candidateAssessmentAnswers.attemptId, attemptId));

      const scoreRaw = scored.reduce(
        (sum, row) => sum + Number(row.pointsEarned ?? 0),
        0,
      );

      const [attempt] = await tx
        .select({ scoreTotal: candidateAssessmentAttempts.scoreTotal })
        .from(candidateAssessmentAttempts)
        .where(eq(candidateAssessmentAttempts.id, attemptId));

      const scoreTotal = Number(attempt?.scoreTotal ?? 0);
      const scorePercentage =
        scoreTotal > 0 ? (scoreRaw / scoreTotal) * 100 : 0;

      const [updated] = await tx
        .update(candidateAssessmentAttempts)
        .set({ scoreRaw, scorePercentage, updatedAt: new Date() })
        .where(eq(candidateAssessmentAttempts.id, attemptId))
        .returning();

      return { attempt: updated };
    });
  },
};

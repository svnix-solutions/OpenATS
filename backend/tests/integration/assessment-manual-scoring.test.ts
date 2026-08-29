import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, runInOrganization } from "../../src/db";
import {
  assessmentQuestions,
  assessmentQuestionOptions,
} from "../../src/db/schema/assessments";
import {
  candidateAssessmentAttempts,
  candidateAssessmentAnswers,
} from "../../src/db/schema/candidates";
import { assessmentExecutionService } from "../../src/modules/assessment-execution/assessment-execution.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * Written answers can be given a mark.
 *
 * `completeAttempt` scores choice questions by comparing selections and gives
 * everything else 0, while still counting its points toward the total. The
 * builder has always told the author those questions are "reviewed manually by
 * the hiring team" — and nothing could record that review, so an assessment
 * with one could never be scored above the fraction the choice questions made
 * up, and a candidate who wrote a perfect answer read as having failed it.
 */

let s: Scenario;
let choiceQuestionId: number;
let writtenQuestionId: number;
let correctOptionId: number;

beforeAll(async () => {
  s = await createScenario("manual-score");
  await runInOrganization(s.organizationId, async () => {
    const questions = await db
      .insert(assessmentQuestions)
      .values([
        {
          assessmentId: s.assessmentId,
          title: "Pick one",
          questionType: "radio",
          points: 10,
          position: 1,
        },
        {
          assessmentId: s.assessmentId,
          title: "Explain yourself",
          questionType: "long_answer",
          points: 10,
          position: 2,
        },
      ])
      .returning({ id: assessmentQuestions.id });
    choiceQuestionId = questions[0]!.id;
    writtenQuestionId = questions[1]!.id;

    const options = await db
      .insert(assessmentQuestionOptions)
      .values([
        { questionId: choiceQuestionId, label: "right", isCorrect: true, position: 1 },
        { questionId: choiceQuestionId, label: "wrong", isCorrect: false, position: 2 },
      ])
      .returning({ id: assessmentQuestionOptions.id });
    correctOptionId = options[0]!.id;
  });
});

afterAll(async () => {
  await destroyScenario(s);
});

/** An attempt with the choice question right and the written one answered. */
async function completedAttempt() {
  await db
    .delete(candidateAssessmentAnswers)
    .where(eq(candidateAssessmentAnswers.attemptId, s.attemptA1));

  // startAttempt only transitions out of "pending", so each case puts the
  // attempt back before running.
  await db
    .update(candidateAssessmentAttempts)
    .set({ status: "pending", startedAt: null, completedAt: null })
    .where(eq(candidateAssessmentAttempts.id, s.attemptA1));

  await assessmentExecutionService.startAttempt(s.attemptA1);
  await assessmentExecutionService.saveAnswer(s.attemptA1, {
    questionId: choiceQuestionId,
    optionIds: [correctOptionId],
  });
  await assessmentExecutionService.saveAnswer(s.attemptA1, {
    questionId: writtenQuestionId,
    answerText: "Because I have done it before, at length.",
  });
  await assessmentExecutionService.completeAttempt(s.attemptA1);

  const [written] = await db
    .select({ id: candidateAssessmentAnswers.id })
    .from(candidateAssessmentAnswers)
    .where(eq(candidateAssessmentAnswers.questionId, writtenQuestionId));

  return written!.id;
}

async function attemptScore() {
  const [row] = await db
    .select({
      raw: candidateAssessmentAttempts.scoreRaw,
      total: candidateAssessmentAttempts.scoreTotal,
      pct: candidateAssessmentAttempts.scorePercentage,
    })
    .from(candidateAssessmentAttempts)
    .where(eq(candidateAssessmentAttempts.id, s.attemptA1));
  return {
    raw: Number(row!.raw),
    total: Number(row!.total),
    pct: Number(row!.pct),
  };
}

describe("scoring a written answer by hand", () => {
  itInOrg("raises the attempt score to match", async () => {
    const answerId = await completedAttempt();

    // Everything answered correctly, and still 50%: the written half earns
    // nothing on its own. That was the whole of the behaviour before this.
    expect(await attemptScore()).toEqual({ raw: 10, total: 20, pct: 50 });

    await assessmentExecutionService.scoreWrittenAnswer(s.attemptA1, answerId, 10);

    expect(await attemptScore()).toEqual({ raw: 20, total: 20, pct: 100 });
  });

  itInOrg("accepts partial credit", async () => {
    const answerId = await completedAttempt();
    await assessmentExecutionService.scoreWrittenAnswer(s.attemptA1, answerId, 4);
    expect(await attemptScore()).toEqual({ raw: 14, total: 20, pct: 70 });
  });

  itInOrg("re-totals rather than adding a delta", async () => {
    const answerId = await completedAttempt();
    await assessmentExecutionService.scoreWrittenAnswer(s.attemptA1, answerId, 10);
    // Scored again, lower. A delta would have added twice and drifted past
    // the total; the score is summed from the answers each time.
    await assessmentExecutionService.scoreWrittenAnswer(s.attemptA1, answerId, 2);
    expect(await attemptScore()).toEqual({ raw: 12, total: 20, pct: 60 });
  });

  itInOrg("refuses more than the question is worth", async () => {
    const answerId = await completedAttempt();
    const result = await assessmentExecutionService.scoreWrittenAnswer(
      s.attemptA1,
      answerId,
      11,
    );
    expect(result).toMatchObject({ error: "over_max", max: 10 });
    // And left the score alone.
    expect(await attemptScore()).toEqual({ raw: 10, total: 20, pct: 50 });
  });

  itInOrg("refuses a choice question", async () => {
    await completedAttempt();
    const [choice] = await db
      .select({ id: candidateAssessmentAnswers.id })
      .from(candidateAssessmentAnswers)
      .where(eq(candidateAssessmentAnswers.questionId, choiceQuestionId));

    // Those are scored from the options marked correct. Overwriting one by
    // hand would make the score untraceable to the answers behind it.
    const result = await assessmentExecutionService.scoreWrittenAnswer(
      s.attemptA1,
      choice!.id,
      10,
    );
    expect(result).toMatchObject({ error: "not_written" });
  });

  itInOrg("refuses an answer belonging to another attempt", async () => {
    const answerId = await completedAttempt();
    // A valid answer id, scored against the wrong attempt — the id space is
    // shared, so this has to be checked rather than assumed.
    const result = await assessmentExecutionService.scoreWrittenAnswer(
      s.attemptA1 + 100000,
      answerId,
      5,
    );
    expect(result).toMatchObject({ error: "not_found" });
  });
});

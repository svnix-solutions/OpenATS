import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, runInOrganization } from "../../src/db";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  shape,
  type Scenario,
} from "../helpers/scenario";
import {
  assessmentQuestionOptions,
  assessmentQuestions,
} from "../../src/db/schema/assessments";
import { candidateAssessmentAttempts } from "../../src/db/schema/candidates";
import { assessmentExecutionService } from "../../src/modules/assessment-execution/assessment-execution.service";

// See characterize-job.test.ts for what these suites are for.
//
// Scoring gets the most attention here because it is the part with no other
// coverage and the part whose current behaviour is least obviously intended.

let s: Scenario;
let radioQuestionId: number;
let textQuestionId: number;
let correctOptionId: number;
let wrongOptionId: number;

beforeAll(async () => {
  s = await createScenario("ae");
  await runInOrganization(s.organizationId, seedQuestions);
});

async function seedQuestions() {
  const questions = await db
    .insert(assessmentQuestions)
    .values([
      {
        assessmentId: s.assessmentId,
        title: "Pick the right one",
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

  radioQuestionId = questions[0]!.id;
  textQuestionId = questions[1]!.id;

  const options = await db
    .insert(assessmentQuestionOptions)
    .values([
      {
        questionId: radioQuestionId,
        label: "Correct",
        isCorrect: true,
        position: 1,
      },
      {
        questionId: radioQuestionId,
        label: "Wrong",
        isCorrect: false,
        position: 2,
      },
    ])
    .returning({ id: assessmentQuestionOptions.id });

  correctOptionId = options[0]!.id;
  wrongOptionId = options[1]!.id;
}

afterAll(async () => {
  await runInOrganization(s.organizationId, cleanupQuestions);
  await destroyScenario(s);
});

async function cleanupQuestions() {
  await db
    .delete(assessmentQuestionOptions)
    .where(inArray(assessmentQuestionOptions.questionId, [radioQuestionId]));
  await db
    .delete(assessmentQuestions)
    .where(eq(assessmentQuestions.assessmentId, s.assessmentId));
}

describe("assessmentExecutionService.getAttemptsByCandidate", () => {
  itInOrg("returns a summary row per attempt, with the assessment title joined", async () => {
    expect(
      shape(await assessmentExecutionService.getAttemptsByCandidate(s.candidateA1)),
    ).toEqual([
      "[].assessmentId",
      "[].assessmentTitle",
      "[].completedAt",
      "[].expiresAt",
      "[].id",
      "[].passed",
      "[].scorePercentage",
      "[].startedAt",
      "[].status",
      "[].token",
    ]);
  });

  itInOrg("includes the invite token, which is the candidate's credential", async () => {
    // Worth pinning: this endpoint is staff-only, and the token it returns is
    // the whole of a candidate's authentication for their assessment.
    const rows = await assessmentExecutionService.getAttemptsByCandidate(
      s.candidateA1,
    );
    expect(rows[0]!.token).toMatch(/^token-a1-/);
  });

  itInOrg("scopes to the candidate", async () => {
    const rows = await assessmentExecutionService.getAttemptsByCandidate(
      s.candidateA1,
    );
    expect(rows.map((r) => r.id)).toEqual([s.attemptA1]);
  });
});

describe("assessmentExecutionService.getAttemptByToken", () => {
  itInOrg("nests the assessment and candidate the public page needs", async () => {
    const attempt = await assessmentExecutionService.getAttemptByToken(
      `token-a1-${s.suffix}`,
    );
    const keys = shape(attempt);

    expect(keys).toContain("assessment.timeLimit");
    expect(keys).toContain("candidate.email");
    expect(keys).toContain("expiresAt");
  });

  itInOrg("returns null for an unknown token", async () => {
    expect(
      await assessmentExecutionService.getAttemptByToken("no-such-token"),
    ).toBeNull();
  });
});

describe("assessmentExecutionService scoring", () => {
  async function scoreWith(optionId: number) {
    // startAttempt only transitions out of "pending", so each case has to put
    // the attempt back before running.
    await db
      .update(candidateAssessmentAttempts)
      .set({ status: "pending", startedAt: null, completedAt: null })
      .where(eq(candidateAssessmentAttempts.id, s.attemptA1));

    await assessmentExecutionService.startAttempt(s.attemptA1);
    await assessmentExecutionService.saveAnswer(s.attemptA1, {
      questionId: radioQuestionId,
      optionIds: [optionId],
    });
    await assessmentExecutionService.saveAnswer(s.attemptA1, {
      questionId: textQuestionId,
      answerText: "a thoroughly correct written answer",
    });
    return assessmentExecutionService.completeAttempt(s.attemptA1);
  }

  itInOrg("counts written answers toward the total but never awards them points", async () => {
    const completed = await scoreWith(correctOptionId);

    // Every choice question answered correctly, and the written answer
    // present — yet the score is 50%, because long_answer contributes its
    // points to the denominator and zero to the numerator. A candidate cannot
    // score above the multiple-choice fraction of an assessment.
    expect(Number(completed!.scoreRaw)).toBe(10);
    expect(Number(completed!.scoreTotal)).toBe(20);
    expect(Number(completed!.scorePercentage)).toBe(50);
  });

  // Pinning a type mismatch, not endorsing it. Every numeric column in the
  // schema is declared `.$type<number>()`, but node-postgres returns numeric
  // as a string to avoid losing precision, and Drizzle passes it through. So
  // TypeScript believes these are numbers and at runtime they are not. The
  // scoring code gets away with it by calling Number() on points; anything
  // that does arithmetic on one of these directly would concatenate instead.
  // The same applies to offers.salary and assessmentQuestions.points.
  itInOrg("returns numeric columns as strings despite their declared type", async () => {
    const completed = await scoreWith(correctOptionId);
    expect(typeof completed!.scoreRaw).toBe("string");
    expect(completed!.scoreRaw as unknown as string).toBe("10.00");
  });

  itInOrg("never decides pass or fail", async () => {
    const completed = await scoreWith(correctOptionId);
    // There is no passing threshold anywhere in the schema, so `passed` is
    // written as null on every completion regardless of score.
    expect(completed!.passed).toBeNull();
  });

  itInOrg("awards nothing for the wrong option", async () => {
    const completed = await scoreWith(wrongOptionId);
    expect(Number(completed!.scoreRaw)).toBe(0);
    expect(Number(completed!.scorePercentage)).toBe(0);
  });

  itInOrg("refuses to complete an attempt that is not started", async () => {
    await expect(
      assessmentExecutionService.completeAttempt(s.attemptB1),
    ).rejects.toThrow(/not in 'started' status/);
  });
});

describe("assessmentExecutionService.getAttemptResults", () => {
  itInOrg("returns the attempt summary alongside a questions array", async () => {
    const keys = shape(await assessmentExecutionService.getAttemptResults(s.attemptA1));
    expect(keys).toContain("attempt.scorePercentage");
    expect(keys).toContain("attempt.candidateName");
    expect(keys.some((k) => k.startsWith("questions[]."))).toBe(true);
  });

  itInOrg("returns null for an attempt that does not exist", async () => {
    expect(
      await assessmentExecutionService.getAttemptResults(2_000_000_000),
    ).toBeNull();
  });
});

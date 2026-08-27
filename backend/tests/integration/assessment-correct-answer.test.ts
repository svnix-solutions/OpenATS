import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  const { jwks } = await import("../helpers/jwks-holder");
  return { ...actual, createRemoteJWKSet: () => async () => jwks.publicKey };
});

import app from "../../src/app";
import { initTestKeys, bearer } from "../helpers/jwt";
import { createScenario, destroyScenario, type Scenario } from "../helpers/scenario";

/**
 * A multiple-choice question with no correct option scores nothing.
 *
 * `completeAttempt` compares the candidate's selections against the options
 * flagged correct; with none flagged, `pointsEarned` is 0 whatever they pick,
 * and the question's points still count toward the total. The assessment can
 * never score anyone above the fraction made up of the other questions.
 *
 * It used to save without complaint. Building one through the product and
 * taking it, a candidate who answered correctly scored 0%, and nothing
 * anywhere said why.
 */

let s: Scenario;

beforeAll(async () => {
  await initTestKeys();
  s = await createScenario("mcq-correct");
});

async function createAssessment(options: { label: string; isCorrect: boolean; position: number }[]) {
  return request(app)
    .post("/api/assessments")
    .set(
      "Authorization",
      await bearer({ sub: s.admin.providerUserId, email: s.admin.email }),
    )
    .send({
      title: `Quiz ${Date.now()}`,
      timeLimit: 30,
      questions: [
        {
          title: "What is 2 + 2?",
          questionType: "multiple_choice",
          points: 1,
          position: 1,
          options,
        },
      ],
    });
}

describe("creating a multiple-choice question", () => {
  it("is refused when no option is marked correct", async () => {
    const res = await createAssessment([
      { label: "4", isCorrect: false, position: 1 },
      { label: "5", isCorrect: false, position: 2 },
    ]);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/correct answer/i);
  });

  it("is accepted when one is", async () => {
    const res = await createAssessment([
      { label: "4", isCorrect: true, position: 1 },
      { label: "5", isCorrect: false, position: 2 },
    ]);

    expect(res.status).toBe(201);
  });

  it("does not impose the rule on short answers, which have no options", async () => {
    // A short-answer question has nothing to mark correct. Applying the rule
    // to every type would reject a perfectly valid assessment.
    const res = await request(app)
      .post("/api/assessments")
      .set(
        "Authorization",
        await bearer({ sub: s.admin.providerUserId, email: s.admin.email }),
      )
      .send({
        title: `Written ${Date.now()}`,
        timeLimit: 30,
        questions: [
          {
            title: "Describe a system you have designed.",
            questionType: "short_answer",
            points: 5,
            position: 1,
          },
        ],
      });

    expect(res.status).toBe(201);
  });

  it("still refuses fewer than two options", async () => {
    // The rule that was already there, kept honest alongside the new one.
    const res = await createAssessment([
      { label: "4", isCorrect: true, position: 1 },
    ]);
    expect(res.status).toBe(400);
  });
});

afterAll(async () => {
  await destroyScenario(s);
});

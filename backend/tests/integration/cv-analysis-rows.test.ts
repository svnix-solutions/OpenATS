import { describe, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";

// The two things this service reaches outside the process: the bucket the CV
// is in, and the model that reads it. Stubbed so the write path can be run
// against a real database, which is where the bug was.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send() {
      // Read with `for await`, so the body has to be async-iterable.
      return Promise.resolve({
        Body: (async function* () {
          yield new Uint8Array([1, 2, 3]);
        })(),
      });
    }
  },
  GetObjectCommand: class {},
}));

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (...a: unknown[]) => generateContent(...a) };
  },
}));
import { db } from "../../src/db";
import { candidateCvAnalysis } from "../../src/db/schema/candidates";
import { cvAnalysisService } from "../../src/modules/candidate/cv-analysis.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * CV analysis is stored per person *and* job: one CV, scored separately
 * against every role that person is up for. The table says so — its only
 * unique constraint is (candidate_id, job_id) — and re-uploading a CV enqueues
 * one job per open application.
 *
 * The service did not. Every write keyed on the person alone, and the one that
 * creates the row named a conflict target that does not exist, so Postgres
 * refused it outright.
 *
 * The existing worker test mocks `cvAnalysisService` wholesale, so none of
 * this was ever executed against a database.
 */

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("cv-rows");
});

afterAll(async () => {
  await destroyScenario(s);
});

async function rowsFor(personId: number) {
  return db
    .select({
      jobId: candidateCvAnalysis.jobId,
      status: candidateCvAnalysis.status,
      score: candidateCvAnalysis.matchScore,
    })
    .from(candidateCvAnalysis)
    .where(eq(candidateCvAnalysis.candidateId, personId));
}

/** The three answers the flow asks the model for, in order. */
function stubTheModel() {
  const parsedCv = {
    documentType: "resume",
    isCvOrResume: true,
    confidence: 0.9,
    rationale: [],
    listedSkills: ["typescript", "postgres"],
    projectTechnologies: [],
    impliedSkills: [],
    certifications: [],
    totalExperienceYears: 6,
    jobLevel: "senior",
  };
  const parsedJd = {
    minExperienceYears: 4,
    jobLevel: "senior",
    requiredCertifications: [],
  };
  const summary = {
    quickSummary: "Reads well.",
    strengths: ["typescript"],
    gaps: [],
    hiringSignal: "worth an interview",
    verdict: "strong_fit",
  };
  generateContent
    .mockResolvedValueOnce({ text: JSON.stringify(parsedCv) })
    .mockResolvedValueOnce({ text: JSON.stringify(parsedJd) })
    .mockResolvedValueOnce({ text: JSON.stringify(summary) });
}

describe("recording a CV analysis", () => {
  itInOrg("creates a row for the person and the job", async () => {
    // Used to throw: ON CONFLICT named candidate_id, and the only unique
    // constraint is (candidate_id, job_id). Postgres rejects a conflict
    // target that matches no index, so this failed on the very first call —
    // and both callers swallow the error into a log line, which is why an
    // application still returned 201 with no analysis behind it.
    await cvAnalysisService.markPending(s.personA1, s.jobA.id);

    const rows = await rowsFor(s.personA1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.jobId).toBe(s.jobA.id);
    expect(rows[0]!.status).toBe("pending");
  });

  itInOrg("keeps one row per job, not one per person", async () => {
    await cvAnalysisService.markPending(s.personA1, s.jobA.id);
    await cvAnalysisService.markPending(s.personA1, s.jobB.id);

    const rows = await rowsFor(s.personA1);
    expect(rows.map((r) => r.jobId).sort()).toEqual(
      [s.jobA.id, s.jobB.id].sort(),
    );
  });

  itInOrg("marks only the job that failed", async () => {
    await cvAnalysisService.markPending(s.personA1, s.jobA.id);
    await cvAnalysisService.markPending(s.personA1, s.jobB.id);

    await cvAnalysisService.markFailed(s.personA1, s.jobA.id, "gemini refused");

    const rows = await rowsFor(s.personA1);
    const byJob = Object.fromEntries(rows.map((r) => [r.jobId, r.status]));
    expect(byJob[s.jobA.id]).toBe("failed");
    // The other role's analysis has nothing to do with this failure. Keyed on
    // the person alone, one failure marked every application failed.
    expect(byJob[s.jobB.id]).toBe("pending");
  });

  itInOrg("writes the result against the job it was scored for", async () => {
    generateContent.mockReset();
    stubTheModel();

    await cvAnalysisService.markPending(s.personA1, s.jobA.id);
    await cvAnalysisService.markPending(s.personA1, s.jobB.id);

    await cvAnalysisService.runAnalysis(
      s.personA1,
      s.jobA.id,
      "https://example.test/bucket/cv.pdf",
    );

    const rows = await rowsFor(s.personA1);
    const byJob = Object.fromEntries(rows.map((r) => [r.jobId, r]));

    expect(byJob[s.jobA.id]!.status).toBe("done");
    expect(Number(byJob[s.jobA.id]!.score)).toBeGreaterThan(0);

    // The other role was never analysed. Keyed on the person alone, this
    // score — computed against jobA's requirements, with jobA's matched
    // skills and jobA's summary — was written onto jobB's row as well, and a
    // recruiter for jobB read it as their own.
    expect(byJob[s.jobB.id]!.status).toBe("pending");
    expect(byJob[s.jobB.id]!.score).toBeNull();
  });
});

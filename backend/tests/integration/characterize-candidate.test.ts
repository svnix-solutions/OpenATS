import { describe, expect, beforeAll, afterAll } from "vitest";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  shape,
  type Scenario,
} from "../helpers/scenario";
import { candidateService } from "../../src/modules/candidate/candidate.service";

// See characterize-job.test.ts for what these suites are for.
//
// The candidate service is the one phase 1 changes most: decisions/0001 §4
// splits this table into a person and an application, so `jobId`, `status` and
// `currentStageId` move off the row these tests describe. Expect this file to
// fail loudly during that work — that is the job it is here to do.

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("cand");
});
afterAll(async () => {
  await destroyScenario(s);
});

// A row is one submission. `id` is the application; `candidateId` is the
// person behind it, who may appear again under another job. Before the split
// there was no way to say that, which is what this list gained.
const ROW_SHAPE = [
  "rows[].appliedAt",
  "rows[].candidateId",
  "rows[].currentStageId",
  "rows[].email",
  "rows[].firstName",
  "rows[].id",
  "rows[].jobId",
  "rows[].jobTitle",
  "rows[].lastName",
  "rows[].phone",
  "rows[].resumeUrl",
  "rows[].stageName",
  "rows[].status",
  "rows[].updatedAt",
];

describe("candidateService.getAll", () => {
  itInOrg("joins the stage name and job title onto each row", async () => {
    const result = await candidateService.getAll(s.jobA.id, {});
    expect(shape(result)).toEqual([
      "limit",
      "page",
      ...ROW_SHAPE,
      "total",
      "totalPages",
    ]);
  });

  itInOrg("scopes to a job when given one", async () => {
    const { rows, total } = await candidateService.getAll(s.jobA.id, {});
    expect(total).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [s.candidateA1, s.candidateA2].sort(),
    );
  });

  itInOrg("defaults to a page size of 25", async () => {
    const result = await candidateService.getAll(s.jobA.id, {});
    expect(result.limit).toBe(25);
    expect(result.page).toBe(1);
  });

  itInOrg("hides other teams' candidates from a team-scoped user", async () => {
    const forInterviewer = await candidateService.getAll(undefined, {
      teamUserId: s.interviewer.id,
    });
    const ids = forInterviewer.rows.map((r) => r.id);

    expect(ids).toContain(s.candidateA1);
    expect(ids).not.toContain(s.candidateB1);
  });

  itInOrg("combines a job filter with the team filter rather than overriding it", async () => {
    // Asking for jobB as someone only on jobA's team yields nothing, rather
    // than jobB's candidates.
    const result = await candidateService.getAll(s.jobB.id, {
      teamUserId: s.interviewer.id,
    });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  itInOrg("filters by status", async () => {
    const rejected = await candidateService.getAll(s.jobA.id, {
      status: "rejected",
    });
    expect(rejected.rows.map((r) => r.id)).toEqual([s.candidateA2]);
  });

  itInOrg("filters by stage", async () => {
    const inFirstStage = await candidateService.getAll(s.jobA.id, {
      stageId: s.jobA.stageIds[0],
    });
    expect(inFirstStage.rows.map((r) => r.id)).toEqual([s.candidateA1]);
  });

  itInOrg("searches across name and email", async () => {
    const byName = await candidateService.getAll(s.jobA.id, { search: "Ada" });
    expect(byName.rows.map((r) => r.id)).toEqual([s.candidateA1]);
  });

  itInOrg("orders by application date, newest first", async () => {
    const { rows } = await candidateService.getAll(s.jobA.id, {});
    const times = rows.map((r) => r.appliedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  itInOrg("paginates without changing the reported total", async () => {
    const page1 = await candidateService.getAll(s.jobA.id, {
      page: 1,
      limit: 1,
    });
    expect(page1.rows).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.totalPages).toBe(2);
  });
});

describe("candidateService.getById", () => {
  itInOrg("assembles the whole candidate detail panel in one call", async () => {
    const candidate = await candidateService.getById(s.candidateA1);
    const keys = shape(candidate);

    // The nested collections are what makes this call expensive and what the
    // application split will have to redistribute.
    for (const key of [
      "activities[]",
      "answers[]",
      "history[]",
      "rejections[]",
      "selections[]",
      "cvAnalysis",
      "jobTitle",
      "stageName",
    ]) {
      expect(keys).toContain(key);
    }
  });

  itInOrg("includes the candidate's interviews and current offer", async () => {
    const candidate = await candidateService.getById(s.candidateA1);
    expect(candidate!.interviews.map((i) => i.id)).toEqual([s.interviewA1]);
    expect(candidate!.offer?.id).toBe(s.offerA1);
  });

  itInOrg("returns null for a candidate that does not exist", async () => {
    expect(await candidateService.getById(2_000_000_000)).toBeNull();
  });
});

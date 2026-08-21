import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createScenario,
  destroyScenario,
  shape,
  type Scenario,
} from "../helpers/scenario";
import { interviewService } from "../../src/modules/interview/interview.service";

// See characterize-job.test.ts for what these suites are for.

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("interview");
});
afterAll(async () => {
  await destroyScenario(s);
});

describe("interviewService.getAll", () => {
  it("flattens candidate, job and stage onto each row", async () => {
    const keys = shape(await interviewService.getAll({ jobId: s.jobA.id }));
    for (const key of [
      "[].candidateName",
      "[].candidateEmail",
      "[].jobTitle",
      "[].stageName",
      "[].stageType",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("does not expose the raw scheduling columns the detail view uses", async () => {
    // publicToken and timeSlots are on the row in getByCandidate but not here.
    const keys = shape(await interviewService.getAll({ jobId: s.jobA.id }));
    expect(keys).not.toContain("[].publicToken");
    expect(keys).not.toContain("[].timeSlots");
  });

  it("returns every interview when unscoped", async () => {
    const ids = (await interviewService.getAll()).map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([s.interviewA1, s.interviewB1]),
    );
  });

  it("hides other teams' interviews from a team-scoped user", async () => {
    const ids = (
      await interviewService.getAll({ teamUserId: s.interviewer.id })
    ).map((i) => i.id);

    expect(ids).toContain(s.interviewA1);
    expect(ids).not.toContain(s.interviewB1);
  });

  it("combines the job filter with the team filter", async () => {
    const rows = await interviewService.getAll({
      jobId: s.jobB.id,
      teamUserId: s.interviewer.id,
    });
    expect(rows).toEqual([]);
  });

  it("filters by department", async () => {
    const ids = (
      await interviewService.getAll({ departmentId: s.departmentId })
    ).map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([s.interviewA1, s.interviewB1]),
    );
  });

  it("searches candidate name and job title", async () => {
    const ids = (
      await interviewService.getAll({
        departmentId: s.departmentId,
        search: "Ada",
      })
    ).map((i) => i.id);
    expect(ids).toEqual([s.interviewA1]);
  });
});

describe("interviewService.getByCandidate", () => {
  it("returns raw interview rows, a different shape from the list", async () => {
    const keys = shape(await interviewService.getByCandidate(s.candidateA1));

    expect(keys).toContain("[].publicToken");
    expect(keys).toContain("[].timeSlots");
    expect(keys).toContain("[].tokenExpiresAt");
    // ...and none of the joined display fields.
    expect(keys).not.toContain("[].candidateName");
    expect(keys).not.toContain("[].jobTitle");
  });

  it("scopes to the candidate", async () => {
    const rows = await interviewService.getByCandidate(s.candidateA1);
    expect(rows.map((i) => i.id)).toEqual([s.interviewA1]);
  });

  it("returns an empty array for a candidate with no interviews", async () => {
    expect(await interviewService.getByCandidate(s.candidateA2)).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createScenario,
  destroyScenario,
  shape,
  type Scenario,
} from "../helpers/scenario";
import { jobService } from "../../src/modules/job/job.service";

// Characterization, not specification. These tests describe what the service
// returns today so that the multi-tenancy rewrite (decisions/0001 phase 1) has
// something to be checked against. Where they pin behaviour that looks wrong,
// that is deliberate and called out — the point is to notice the change, not
// to bless it.
//
// Assertions key on the scenario's own ids rather than row counts: vitest runs
// files in parallel, so another suite's fixtures are in the table too.

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("job");
});
afterAll(async () => {
  await destroyScenario(s);
});

const LIST_SHAPE = [
  "[].applicationEmailTemplateId",
  "[].createdAt",
  "[].createdBy",
  "[].currency",
  "[].departmentId",
  "[].description",
  "[].employmentType",
  "[].id",
  "[].location",
  "[].payFrequency",
  "[].salaryFixed",
  "[].salaryMax",
  "[].salaryMin",
  "[].salaryType",
  "[].skills[]",
  "[].slug",
  "[].status",
  "[].title",
  "[].updatedAt",
];

describe("jobService.getAll", () => {
  it("returns the full job row plus a flattened skills array", async () => {
    expect(shape(await jobService.getAll())).toEqual(LIST_SHAPE);
  });

  it("returns every job when given no user", async () => {
    const ids = (await jobService.getAll()).map((j) => j.id);
    expect(ids).toContain(s.jobA.id);
    expect(ids).toContain(s.jobB.id);
  });

  it("narrows to hiring-team membership when given a user id", async () => {
    const ids = (await jobService.getAll(s.interviewer.id)).map((j) => j.id);
    expect(ids).toContain(s.jobA.id);
    expect(ids).not.toContain(s.jobB.id);
  });

  it("gives a manager on both teams both jobs", async () => {
    const ids = (await jobService.getAll(s.manager.id)).map((j) => j.id);
    expect(ids).toEqual(expect.arrayContaining([s.jobA.id, s.jobB.id]));
  });
});

describe("jobService.getPaginated", () => {
  it("wraps rows with total, page, limit and totalPages", async () => {
    const result = await jobService.getPaginated({
      departmentId: s.departmentId,
      page: 1,
      limit: 10,
    });

    expect(shape(result)).toEqual([
      "limit",
      "page",
      ...LIST_SHAPE.map((k) => `rows${k}`),
      "total",
      "totalPages",
    ]);
    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(1);
  });

  it("computes totalPages from the unpaged total, not the page size", async () => {
    const page1 = await jobService.getPaginated({
      departmentId: s.departmentId,
      page: 1,
      limit: 1,
    });
    const page2 = await jobService.getPaginated({
      departmentId: s.departmentId,
      page: 2,
      limit: 1,
    });

    expect(page1.total).toBe(2);
    expect(page1.totalPages).toBe(2);
    expect(page1.rows).toHaveLength(1);
    expect(page2.rows).toHaveLength(1);
    expect(page1.rows[0]!.id).not.toBe(page2.rows[0]!.id);
  });

  it("orders newest first", async () => {
    const { rows } = await jobService.getPaginated({
      departmentId: s.departmentId,
      page: 1,
      limit: 10,
    });
    // jobB is created after jobA by the fixture.
    expect(rows.map((r) => r.id)).toEqual([s.jobB.id, s.jobA.id]);
  });
});

describe("jobService.getById", () => {
  it("nests hiringTeam and pipelineStages that the list endpoints omit", async () => {
    const job = await jobService.getById(s.jobA.id);

    expect(shape(job)).toEqual([
      "applicationEmailTemplateId",
      "createdAt",
      "createdBy",
      "currency",
      "departmentId",
      "description",
      "employmentType",
      "hiringTeam[].addedAt",
      "hiringTeam[].id",
      "hiringTeam[].jobId",
      "hiringTeam[].userId",
      "id",
      "location",
      "payFrequency",
      "pipelineStages[].createdAt",
      "pipelineStages[].id",
      "pipelineStages[].jobId",
      "pipelineStages[].name",
      "pipelineStages[].position",
      "pipelineStages[].sourceTemplateId",
      "pipelineStages[].stageType",
      "pipelineStages[].updatedAt",
      "salaryFixed",
      "salaryMax",
      "salaryMin",
      "salaryType",
      "skills[]",
      "slug",
      "status",
      "title",
      "updatedAt",
    ]);
  });

  it("orders pipeline stages by position", async () => {
    const job = await jobService.getById(s.jobA.id);
    expect(job!.pipelineStages.map((p) => p.position)).toEqual([1, 2, 3]);
    expect(job!.pipelineStages.map((p) => p.id)).toEqual(s.jobA.stageIds);
  });

  it("returns skills as plain strings, not rows", async () => {
    const job = await jobService.getById(s.jobA.id);
    expect([...job!.skills].sort()).toEqual(["postgres", "typescript"]);
  });

  it("returns null for a job that does not exist", async () => {
    expect(await jobService.getById(2_000_000_000)).toBeNull();
  });
});

describe("jobService.getBySlug", () => {
  it("returns a flatter row than getById — no team, no stages", async () => {
    const job = await jobService.getBySlug(s.jobA.slug);
    expect(shape(job)).toEqual(LIST_SHAPE.map((k) => k.replace("[].", "")));
    expect(job!.id).toBe(s.jobA.id);
  });
});

describe("jobService.listPublishedForCareers", () => {
  it("projects only the seven fields the public careers page needs", async () => {
    expect(shape(await jobService.listPublishedForCareers())).toEqual([
      "[].createdAt",
      "[].departmentName",
      "[].employmentType",
      "[].id",
      "[].location",
      "[].slug",
      "[].title",
    ]);
  });

  it("resolves the department name rather than exposing its id", async () => {
    const rows = await jobService.listPublishedForCareers();
    const mine = rows.find((r) => r.id === s.jobA.id);
    expect(mine?.departmentName).toBe(`Dept ${s.suffix}`);
  });
});

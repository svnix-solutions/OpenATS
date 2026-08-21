import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  shape,
  type Scenario,
} from "../helpers/scenario";
import { candidates } from "../../src/db/schema/candidates";
import { reportService } from "../../src/modules/report/report.service";

// See characterize-job.test.ts for what these suites are for.
//
// Analytics is the one service phase 1 does not obviously touch, which is
// exactly why it is worth pinning: it is built from raw SQL over every job in
// the database and served from a process-wide cache.

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("report");
});
afterAll(async () => {
  await destroyScenario(s);
});

describe("reportService.getAnalytics", () => {
  itInOrg("returns a summary plus five report sections", async () => {
    const report = await reportService.getAnalytics("7d", s.departmentId);

    expect(Object.keys(report).sort()).toEqual([
      "candidateVolume",
      "offerTrends",
      "pipelineReport",
      "sourceOfCandidates",
      "summary",
      "timeToHireByDepartment",
    ]);
  });

  itInOrg("reports the summary metrics the dashboard tiles read", async () => {
    const report = await reportService.getAnalytics("7d", s.departmentId);

    expect(shape(report.summary)).toEqual([
      "avgTimeToHireDays",
      "avgTimeToHireDeltaDays",
      "offerAcceptanceRate",
      "offerAcceptanceRateDeltaPct",
      "openPositions",
      "openPositionsDelta",
      "totalCandidates",
      "totalCandidatesDeltaPct",
    ]);
  });

  itInOrg("counts only the requested department", async () => {
    const report = await reportService.getAnalytics("90d", s.departmentId);

    // Both fixture jobs are published, and all three fixture candidates
    // applied just now.
    expect(report.summary.openPositions).toBe(2);
    expect(report.summary.totalCandidates).toBe(3);
  });

  itInOrg("has no notion of who is asking", async () => {
    // getAnalytics takes a period and a department and nothing else. There is
    // no user, so no team scoping: an interviewer on one job sees figures
    // aggregated across every job in the department. Phase 1 has to give this
    // an organization dimension.
    expect(reportService.getAnalytics).toHaveLength(2);
  });
});

describe("reportService.getAnalytics caching", () => {
  itInOrg("serves a stale result for the same period and department", async () => {
    const before = await reportService.getAnalytics("90d", s.departmentId);
    expect(before.summary.totalCandidates).toBe(3);

    await db
      .delete(candidates)
      .where(eq(candidates.id, s.candidateA2));

    const after = await reportService.getAnalytics("90d", s.departmentId);

    // Still 3. The 60 second cache has not expired, so the deletion is
    // invisible. Correct enough for a dashboard tile today.
    expect(after.summary.totalCandidates).toBe(3);

    // ...but the cache key is `${period}|${departmentId}` and nothing else.
    // Once rows carry an organization, two tenants asking for the same period
    // collide on that key and one is served the other's figures. This test
    // exists to make that concrete before it is a leak.
    const other = await reportService.getAnalytics("90d", s.departmentId);
    expect(other).toBe(after);
  });

  itInOrg("keys separately per period", async () => {
    const sevenDay = await reportService.getAnalytics("7d", s.departmentId);
    const ninetyDay = await reportService.getAnalytics("90d", s.departmentId);
    expect(sevenDay).not.toBe(ninetyDay);
  });
});

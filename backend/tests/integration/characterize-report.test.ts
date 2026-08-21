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
import { runInOrganization } from "../../src/db";

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

  itInOrg("still has no notion of which *user* is asking", async () => {
    // Phase 1 gave this an organization dimension, so figures no longer cross
    // tenants. It still has no user dimension: an interviewer on one job sees
    // everything in their organization's department. That is a phase 3
    // question, not an isolation one.
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

    const other = await reportService.getAnalytics("90d", s.departmentId);
    expect(other).toBe(after);
  });

  itInOrg("keys separately per organization, not just per period", async () => {
    // The cache sits in front of the queries, so row-level security cannot
    // help here — the key has to carry the organization itself.
    const mine = await reportService.getAnalytics("7d", s.departmentId);
    const theirs = await runInOrganization(s.organizationId + 100_000, () =>
      reportService.getAnalytics("7d", s.departmentId),
    );
    expect(theirs).not.toBe(mine);
    expect(theirs.summary.totalCandidates).toBe(0);
  });

  itInOrg("keys separately per period", async () => {
    const sevenDay = await reportService.getAnalytics("7d", s.departmentId);
    const ninetyDay = await reportService.getAnalytics("90d", s.departmentId);
    expect(sevenDay).not.toBe(ninetyDay);
  });
});

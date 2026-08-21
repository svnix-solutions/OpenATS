import { describe, expect, beforeAll, afterAll } from "vitest";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  shape,
  type Scenario,
} from "../helpers/scenario";
import { offerService } from "../../src/modules/offer/offer.service";

// See characterize-job.test.ts for what these suites are for.

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("offer");
});
afterAll(async () => {
  await destroyScenario(s);
});

describe("offerService.getAllDetails", () => {
  itInOrg("nests the candidate's current stage and the job's department", async () => {
    const keys = shape(await offerService.getAllDetails());
    for (const key of [
      "[].candidate.currentStage.name",
      "[].candidate.email",
      "[].job.department.name",
      "[].job.title",
      "[].template",
      "[].reviewToken",
    ]) {
      expect(keys).toContain(key);
    }
  });

  itInOrg("returns every offer when unscoped", async () => {
    const ids = (await offerService.getAllDetails()).map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([s.offerA1, s.offerB1]));
  });

  itInOrg("hides other teams' offers from a team-scoped user", async () => {
    const ids = (await offerService.getAllDetails(s.interviewer.id)).map(
      (o) => o.id,
    );
    expect(ids).toContain(s.offerA1);
    expect(ids).not.toContain(s.offerB1);
  });
});

describe("offerService.getPaginated", () => {
  itInOrg("applies the same team scoping as the unpaged list", async () => {
    const result = await offerService.getPaginated({
      teamUserId: s.interviewer.id,
      page: 1,
      limit: 50,
    });
    const ids = result.rows.map((o) => o.id);

    expect(ids).toContain(s.offerA1);
    expect(ids).not.toContain(s.offerB1);
  });

  itInOrg("filters by status", async () => {
    const sent = await offerService.getPaginated({
      jobId: s.jobB.id,
      status: "sent",
    });
    expect(sent.rows.map((o) => o.id)).toEqual([s.offerB1]);

    const draft = await offerService.getPaginated({
      jobId: s.jobB.id,
      status: "draft",
    });
    expect(draft.rows).toEqual([]);
  });

  // Pinning a defect, not endorsing it. `search` is applied in JavaScript to
  // the rows of the page already fetched, while `total` is counted without it.
  // So a search reports the unfiltered count, and only finds matches that
  // happen to land on the current page. Whoever fixes this should expect these
  // two tests to fail, and should delete them rather than adjust them.
  itInOrg("counts without applying search, so total disagrees with rows", async () => {
    const result = await offerService.getPaginated({
      jobId: s.jobA.id,
      search: "definitely-no-such-candidate",
    });

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  itInOrg("searches only within the current page", async () => {
    const matching = await offerService.getPaginated({
      jobId: s.jobA.id,
      search: "Ada",
      page: 1,
      limit: 50,
    });
    expect(matching.rows.map((o) => o.id)).toEqual([s.offerA1]);

    // The same search on a page that cannot contain the match finds nothing,
    // even though the offer exists.
    const offPage = await offerService.getPaginated({
      jobId: s.jobA.id,
      search: "Ada",
      page: 2,
      limit: 50,
    });
    expect(offPage.rows).toEqual([]);
  });
});

describe("offerService.getById", () => {
  itInOrg("nests less than the list does — no currentStage, no department", async () => {
    const keys = shape(await offerService.getById(s.offerA1));

    expect(keys).toContain("candidate.email");
    expect(keys).toContain("job.title");
    expect(keys).not.toContain("candidate.currentStage.name");
    expect(keys).not.toContain("job.department.name");
  });

  // jobService.getById and candidateService.getById both return null here.
  // This one returns undefined. Callers use `if (!result)` so nothing is
  // broken today, but the two are easy to conflate during a rewrite.
  itInOrg("returns undefined — not null — for an offer that does not exist", async () => {
    expect(await offerService.getById(2_000_000_000)).toBeUndefined();
  });
});

describe("offerService.getAllByJob", () => {
  itInOrg("returns flat offer rows with nothing nested", async () => {
    const keys = shape(await offerService.getAllByJob(s.jobA.id));
    expect(keys).toContain("[].candidateId");
    expect(keys.some((k) => k.includes("candidate."))).toBe(false);
    expect(keys.some((k) => k.includes("job."))).toBe(false);
  });

  itInOrg("scopes to the job", async () => {
    const ids = (await offerService.getAllByJob(s.jobA.id)).map((o) => o.id);
    expect(ids).toEqual([s.offerA1]);
  });
});

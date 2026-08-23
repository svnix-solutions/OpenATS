import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, runInOrganization } from "../../src/db";
import {
  createScenario,
  destroyScenario,
  itInOrg,
  type Scenario,
} from "../helpers/scenario";
import { clientCompanies } from "../../src/db/schema/organizations";
import { jobs } from "../../src/db/schema/jobs";
import {
  canReadCandidate,
  canReadJob,
  listScopeFor,
} from "../../src/shared/auth/job-access";
import { jobService } from "../../src/modules/job/job.service";
import { candidateService } from "../../src/modules/candidate/candidate.service";
import type { AuthenticatedUser } from "../../src/shared/auth/verify-token";

// A client contact is inside the agency's organization, so row-level security
// does not separate them from the agency's other clients — that is a second
// boundary, and this is the suite that holds it.
//
// The scenario's two jobs are both under one client company, so the fixture
// gives jobB its own to make "another client" real.

let s: Scenario;
let otherClientId: number;
let client: AuthenticatedUser;

beforeAll(async () => {
  s = await createScenario("client");

  await runInOrganization(s.organizationId, async () => {
    const [other] = await db
      .insert(clientCompanies)
      .values({
        organizationId: s.organizationId,
        name: `Other ${s.suffix}`,
        slug: `other-${s.suffix}`,
      })
      .returning({ id: clientCompanies.id });
    otherClientId = other!.id;

    // jobB now belongs to a different client of the same agency.
    await db
      .update(jobs)
      .set({ clientCompanyId: otherClientId })
      .where(eq(jobs.id, s.jobB.id));
  });

  client = {
    ...s.interviewer,
    role: "client_reviewer",
    clientCompanyId: s.clientCompanyId,
  };
});

afterAll(async () => {
  await runInOrganization(s.organizationId, async () => {
    // Put jobB back so the scenario teardown can remove the client company.
    await db
      .update(jobs)
      .set({ clientCompanyId: s.clientCompanyId })
      .where(eq(jobs.id, s.jobB.id));
    await db
      .delete(clientCompanies)
      .where(eq(clientCompanies.id, otherClientId));
  });
  await destroyScenario(s);
});

describe("a client contact", () => {
  itInOrg("may read a job for their own company", async () => {
    expect(await canReadJob(client, s.jobA.id)).toBe(true);
  });

  itInOrg("may not read another client's job in the same agency", async () => {
    // Same organization, so row-level security lets this row through. The
    // client boundary is what stops it.
    expect(await canReadJob(client, s.jobB.id)).toBe(false);
  });

  itInOrg("may not read a candidate on another client's job", async () => {
    expect(await canReadCandidate(client, s.candidateA1)).toBe(true);
    expect(await canReadCandidate(client, s.candidateB1)).toBe(false);
  });

  itInOrg("is scoped by company, not by hiring team", async () => {
    // They are on no hiring team at all. Scoping them the way an interviewer
    // is scoped would show them nothing.
    expect(listScopeFor(client)).toEqual({
      clientCompanyId: s.clientCompanyId,
    });
  });

  itInOrg("sees only their own company's jobs in the list", async () => {
    const scope = listScopeFor(client);
    const ids = (
      await jobService.getAll(scope.teamUserId, scope.clientCompanyId)
    ).map((j) => j.id);

    expect(ids).toContain(s.jobA.id);
    expect(ids).not.toContain(s.jobB.id);
  });

  itInOrg("sees only their own company's candidates", async () => {
    const { rows } = await candidateService.getAll(undefined, {
      ...listScopeFor(client),
    });
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(s.candidateA1);
    expect(ids).not.toContain(s.candidateB1);
  });

  itInOrg("does not narrow agency staff", async () => {
    // The manager is not client-scoped, so nothing changes for them.
    expect(listScopeFor(s.manager)).toEqual({});
    expect(await canReadJob(s.manager, s.jobB.id)).toBe(true);
  });
});

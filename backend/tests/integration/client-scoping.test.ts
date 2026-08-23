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
import { presentCandidate } from "../../src/shared/auth/present";
import { interviewFeedback } from "../../src/db/schema/interview-feedback";
import { interviewService } from "../../src/modules/interview/interview.service";
import { denyClients } from "../../src/middlewares/role.middleware";
import type { NextFunction } from "express";
import { candidateChatMessages } from "../../src/db/schema/communications";
import { getCandidateChatHistory } from "../../src/modules/chat/chat.controller";
import type { Request, Response } from "express";
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

  itInOrg("is not shown the agency's working view of a candidate", async () => {
    const detail = await candidateService.getById(s.candidateA1);
    const shown = presentCandidate(detail!, client);

    // Contact details are the agency's leverage: handing them over is handing
    // over the ability to hire around the agency.
    expect(shown.email).toBeNull();
    expect(shown.phone).toBeNull();

    // The agency's own assessment of someone it is putting forward.
    expect(shown.cvAnalysis).toBeNull();
    expect(shown.rejections).toEqual([]);
  });

  itInOrg("is still shown what it needs to review the candidate", async () => {
    // Redaction that removes the CV would make the portal pointless.
    const detail = await candidateService.getById(s.candidateA1);
    const shown = presentCandidate(detail!, client);

    expect(shown.firstName).toBe(detail!.firstName);
    expect(shown.jobTitle).toBe(detail!.jobTitle);
    expect(shown).toHaveProperty("resumeUrl", detail!.resumeUrl);
    expect(shown.interviews).toEqual(detail!.interviews);
  });

  itInOrg("changes nothing for agency staff", async () => {
    const detail = await candidateService.getById(s.candidateA1);
    expect(presentCandidate(detail!, s.manager)).toEqual(detail);
  });

  itInOrg("reads only chat that was shared with them", async () => {
    await db.insert(candidateChatMessages).values([
      {
        applicationId: s.candidateA1,
        senderId: s.admin.id,
        message: "internal note about this candidate",
      },
      {
        applicationId: s.candidateA1,
        senderId: s.admin.id,
        message: "shared with the client",
        visibility: "shared",
      },
    ]);

    const seen = async (viewer: AuthenticatedUser) => {
      let body: unknown;
      const res = {
        status() {
          return this;
        },
        json(payload: unknown) {
          body = payload;
          return this;
        },
      } as unknown as Response;

      await getCandidateChatHistory(
        {
          user: viewer,
          params: { candidateId: String(s.candidateA1) },
        } as unknown as Request,
        res,
      );

      return ((body as { data?: { message: string }[] }).data ?? []).map(
        (m) => m.message,
      );
    };

    // Default is internal, so a message written without a thought about the
    // client stays away from them.
    expect(await seen(client)).toEqual(["shared with the client"]);

    const staff = await seen(s.manager);
    expect(staff).toContain("internal note about this candidate");
    expect(staff).toContain("shared with the client");
  });

  itInOrg("reads only interview feedback they wrote themselves", async () => {
    await db.insert(interviewFeedback).values([
      {
        interviewId: s.interviewA1,
        authorId: s.admin.id,
        content: "agency's candid view",
      },
      {
        interviewId: s.interviewA1,
        authorId: client.id,
        content: "the client's own note",
      },
    ]);

    const forClient = await interviewService.getFeedback(
      s.interviewA1,
      client.id,
    );
    expect(forClient.map((f) => f.content)).toEqual(["the client's own note"]);

    // Agency staff still see everything on the interview.
    const forStaff = await interviewService.getFeedback(s.interviewA1);
    expect(forStaff).toHaveLength(2);
  });

  itInOrg("is refused every agency-wide surface, not just analytics", async () => {
    // These have no client dimension to narrow by: assessment definitions and
    // email templates belong to the agency, and allocated-slots is every
    // booked interview across every client. A client reading any of them sees
    // the shape of the agency's whole operation.
    const denied = (viewer: AuthenticatedUser) =>
      new Promise<number | null>((resolve) => {
        let status: number | null = null;
        const res = {
          status(code: number) {
            status = code;
            return this;
          },
          json() {
            resolve(status);
            return this;
          },
        } as unknown as Response;
        const next: NextFunction = () => resolve(null);
        denyClients({ user: viewer } as unknown as Request, res, next);
      });

    expect(await denied(client)).toBe(403);
    expect(await denied(s.manager)).toBeNull();
    expect(await denied(s.interviewer)).toBeNull();
  });

  itInOrg("is refused agency-wide analytics outright", async () => {
    // Analytics counts every submission in the organization and has no client
    // dimension to narrow by, so a client reading it would see the agency's
    // whole book of business as a number. Refused rather than narrowed.
    const run = (viewer: AuthenticatedUser) =>
      new Promise<number | null>((resolve) => {
        let status: number | null = null;
        const res = {
          status(code: number) {
            status = code;
            return this;
          },
          json() {
            resolve(status);
            return this;
          },
        } as unknown as Response;
        const next: NextFunction = () => resolve(null);
        denyClients({ user: viewer } as unknown as Request, res, next);
      });

    expect(await run(client)).toBe(403);
    // Agency staff are unaffected, including interviewers.
    expect(await run(s.interviewer)).toBeNull();
    expect(await run(s.manager)).toBeNull();
  });
});

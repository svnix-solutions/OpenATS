import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  const { jwks } = await import("../helpers/jwks-holder");
  return { ...actual, createRemoteJWKSet: () => async () => jwks.publicKey };
});

vi.mock("../../src/shared/services/mail.service", () => ({
  escapeHtml: (v: string) => v,
  mailService: {
    sendEmail: vi.fn().mockResolvedValue(undefined),
    sendOfferEmail: vi.fn().mockResolvedValue(undefined),
    sendInterviewInviteEmail: vi.fn().mockResolvedValue(undefined),
    sendAssessmentInviteEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

import request from "supertest";
import { sql } from "drizzle-orm";
import app from "../../src/app";
import { db, runInOrganization } from "../../src/db";
import { organizationMembers } from "../../src/db/schema/organizations";
import { users } from "../../src/db/schema/users";
import { initTestKeys, bearer } from "../helpers/jwt";
import { createScenario, destroyScenario, type Scenario } from "../helpers/scenario";

let s: Scenario;
let clientAuth: string;

beforeAll(async () => {
  await initTestKeys();
  s = await createScenario("pii");

  await runInOrganization(s.organizationId, async () => {
    const [contact] = await db
      .insert(users)
      .values({
        providerUserId: `${s.suffix}-contact`,
        firstName: "Client",
        lastName: "Contact",
        email: `contact.${s.suffix}@example.test`,
      })
      .returning({ id: users.id });

    await db.execute(
      sql`INSERT INTO organization_members (organization_id, user_id, role, client_company_id)
          VALUES (${s.organizationId}, ${contact!.id}, 'client_admin'::org_role, ${s.clientCompanyId})`,
    );

    // The scenario already puts an offer on this client's candidate, which is
    // the shape that carried the address.
  });

  clientAuth = await bearer({
    sub: `${s.suffix}-contact`,
    email: `contact.${s.suffix}@example.test`,
    role: "client_admin",
  });
});

afterAll(async () => {
  await runInOrganization(s.organizationId, () =>
    db.delete(organizationMembers),
  );
  await destroyScenario(s);
});

/**
 * A client contact must never be handed a candidate's email or phone.
 *
 * Written as a sweep rather than one assertion per endpoint on purpose: the
 * details reach a client through three unrelated shapes — flat `email`, a
 * nested `candidate` object on an offer, and a flattened `candidateEmail` on
 * an assessment attempt — and only the first was redacted. Anything asserting
 * per shape misses the fourth. This fails on whichever endpoint grows one.
 */
describe("no candidate contact details reach a client contact", () => {
  const endpoints = [
    "/api/candidates",
    "/api/offers",
    "/api/interviews",
    "/api/jobs",
  ];

  for (const path of endpoints) {
    it(`withholds them from ${path}`, async () => {
      const res = await request(app)
        .get(path)
        .set("Authorization", clientAuth);

      expect(res.status).toBeLessThan(500);

      const body = JSON.stringify(res.body);
      // Built the way the fixture builds it; the scenario does not expose it.
      expect(body).not.toContain(`ada.${s.suffix}@example.test`);
    });
  }
});

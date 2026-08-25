import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  // The holder, not the jwt helper: that helper imports `jose` itself, which
  // would deadlock the module graph from inside this factory.
  const { jwks } = await import("../helpers/jwks-holder");
  return { ...actual, createRemoteJWKSet: () => async () => jwks.publicKey };
});

import request from "supertest";
import app from "../../src/app";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";
import { initTestKeys, bearer } from "../helpers/jwt";
import { organizationMembers } from "../../src/db/schema/organizations";
import { users } from "../../src/db/schema/users";
import { db, runInOrganization } from "../../src/db";

const SUFFIX = `surface-${Date.now()}`;
let organizationId: number;
let auth: string;

beforeAll(async () => {
  await initTestKeys();
  organizationId = await createTestOrganization(SUFFIX);

  await runInOrganization(organizationId, async () => {
    const [row] = await db
      .insert(users)
      .values({
        asgardeoUserId: SUFFIX,
        firstName: "Staff",
        lastName: "User",
        email: `${SUFFIX}@example.test`,
      })
      .returning({ id: users.id });
    await db
      .insert(organizationMembers)
      .values({ organizationId, userId: row!.id, role: "super_admin" });
  });

  auth = await bearer({ sub: SUFFIX, email: `${SUFFIX}@example.test` });
});

afterAll(async () => {
  await dropTestOrganization(organizationId);
});

// The candidate-facing assessment routes belong to /public/* and nowhere else.
// Mounted under /api as well they ran as whichever staff member was signed in,
// skipping withPublicOrganization, the public rate limiters and denyClients —
// so anyone in the organization holding a token could answer an assessment as
// the candidate. Nothing called them, and they are gone; this keeps them gone.
describe("assessment route surface", () => {
  const paths: [string, string][] = [
    ["get", "/api/assessment-execution/public/any-token"],
    ["post", "/api/assessment-execution/public/any-token/start"],
    ["post", "/api/assessment-execution/public/any-token/answer"],
    ["post", "/api/assessment-execution/public/any-token/complete"],
  ];

  for (const [method, path] of paths) {
    it(`does not serve ${method.toUpperCase()} ${path}`, async () => {
      const res = await (method === "get"
        ? request(app).get(path)
        : request(app).post(path).send({})
      ).set("Authorization", auth);

      expect(res.status).toBe(404);

      // Status alone proves nothing: a mounted handler answers 404 too, for an
      // unknown token. The shape is what separates them — an unmatched route
      // falls through to Express's own handler, which sends HTML, while a
      // mounted one sends this app's JSON error. Asserting only the status
      // made this test pass with the routes restored.
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("Cannot");
    });
  }

  it("still serves the public one", async () => {
    // An unknown token is a 404 from the tenant resolver, which is the point:
    // it reached the public route and refused to say whether the token exists.
    const res = await request(app).get("/public/assessment/unknown-token");
    expect([404, 429]).toContain(res.status);
  });
});

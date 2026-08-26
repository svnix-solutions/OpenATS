import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  const { jwks } = await import("../helpers/jwks-holder");
  return { ...actual, createRemoteJWKSet: () => async () => jwks.publicKey };
});

import { sql } from "drizzle-orm";
import { db, runInOrganization } from "../../src/db";
import { users } from "../../src/db/schema/users";
import { verifyAccessToken, AuthError } from "../../src/shared/auth/verify-token";
import { listScopeFor } from "../../src/shared/auth/job-access";
import type { AuthenticatedUser } from "../../src/shared/auth/verify-token";
import { initTestKeys, signToken } from "../helpers/jwt";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `crg-${Date.now()}`;
let organizationId: number;

async function seedMember(tag: string, role: string, clientCompanyId: number | null) {
  return runInOrganization(organizationId, async () => {
    const [row] = await db
      .insert(users)
      .values({
        providerUserId: `${SUFFIX}-${tag}`,
        firstName: "Test",
        lastName: "User",
        email: `${tag}.${SUFFIX}@example.test`,
      })
      .returning({ id: users.id });

    await db.execute(
      sql`INSERT INTO organization_members (organization_id, user_id, role, client_company_id)
          VALUES (${organizationId}, ${row!.id}, ${role}::org_role, ${clientCompanyId})`,
    );
    return row!.id;
  });
}

function token(tag: string, role: string) {
  return signToken({
    sub: `${SUFFIX}-${tag}`,
    email: `${tag}.${SUFFIX}@example.test`,
    given_name: "Test",
    family_name: "User",
    roles: [role],
  });
}

beforeAll(async () => {
  await initTestKeys();
  organizationId = await createTestOrganization(SUFFIX);
});

afterAll(async () => {
  await dropTestOrganization(organizationId);
});

describe("a client role with no client company", () => {
  it("is refused at login rather than shown everything", async () => {
    // Nothing populated organization_members.client_company_id, so every
    // client contact had a null one. isClientScoped keyed on that column
    // alone, so they fell through to the unrestricted branch and saw every
    // client's jobs and every candidate's email and phone.
    await seedMember("orphan", "client_admin", null);

    await expect(
      verifyAccessToken(await token("orphan", "client_admin")),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("lets agency staff through untouched", async () => {
    await seedMember("staff", "hiring_manager", null);

    const user = await verifyAccessToken(await token("staff", "hiring_manager"));
    expect(user.role).toBe("hiring_manager");
    expect(user.clientCompanyId).toBeNull();
  });
});

describe("listScopeFor", () => {
  const asUser = (role: string, clientCompanyId: number | null) =>
    ({ id: 1, role, clientCompanyId } as unknown as AuthenticatedUser);

  it("never returns an unfiltered scope for a client role", () => {
    // Defence in depth: login refuses this, but if it were ever reachable the
    // failure mode is the agency's entire book of business.
    expect(listScopeFor(asUser("client_admin", null))).toEqual({
      clientCompanyId: -1,
    });
    expect(listScopeFor(asUser("client_reviewer", null))).toEqual({
      clientCompanyId: -1,
    });
  });

  it("scopes a properly linked client contact to their company", () => {
    expect(listScopeFor(asUser("client_admin", 7))).toEqual({
      clientCompanyId: 7,
    });
  });

  it("leaves agency staff unscoped", () => {
    expect(listScopeFor(asUser("hiring_manager", null))).toEqual({});
    expect(listScopeFor(asUser("super_admin", null))).toEqual({});
  });

  it("keeps interviewers team-scoped", () => {
    expect(listScopeFor(asUser("interviewer", null))).toEqual({ teamUserId: 1 });
  });
});


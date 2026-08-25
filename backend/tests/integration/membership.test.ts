import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, runInOrganization } from "../../src/db";
import { users } from "../../src/db/schema/users";
import {
  ClientCompanyRequiredError,
  MembershipNotFoundError,
  UnknownClientCompanyError,
  membershipService,
  userService,
} from "../../src/modules/user/user.service";
import { clientCompanyService } from "../../src/modules/client-company/client-company.service";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `mem-${Date.now()}`;
let organizationId: number;
let otherOrganizationId: number;
let userId: number;
let clientCompanyId: number;
let foreignClientCompanyId: number;

async function member(tag: string, role: string) {
  return runInOrganization(organizationId, async () => {
    const [row] = await db
      .insert(users)
      .values({
        asgardeoUserId: `${SUFFIX}-${tag}`,
        firstName: tag,
        lastName: "User",
        email: `${tag}.${SUFFIX}@example.test`,
      })
      .returning({ id: users.id });
    await db.execute(
      sql`INSERT INTO organization_members (organization_id, user_id, role)
          VALUES (${organizationId}, ${row!.id}, ${role}::org_role)`,
    );
    return row!.id;
  });
}

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
  otherOrganizationId = await createTestOrganization(`${SUFFIX}-other`);
  userId = await member("target", "interviewer");
  clientCompanyId = (await runInOrganization(organizationId, () =>
    clientCompanyService.create({ name: "Acme", slug: `acme-${SUFFIX}` }),
  ))!.id;
  foreignClientCompanyId = (await runInOrganization(otherOrganizationId, () =>
    clientCompanyService.create({ name: "Other", slug: `other-${SUFFIX}` }),
  ))!.id;
});

afterAll(async () => {
  await dropTestOrganization(otherOrganizationId);
  await dropTestOrganization(organizationId);
});

describe("membership", () => {
  it("changes the role that actually governs access", async () => {
    // The token's role seeds this column once and is ignored afterwards, so
    // updating the identity provider alone changed nothing.
    const updated = await runInOrganization(organizationId, () =>
      membershipService.update(userId, { role: "hiring_manager" }),
    );
    expect(updated?.role).toBe("hiring_manager");
  });

  it("refuses a client role with no client company", async () => {
    // The same rule verify-token enforces at sign-in: without the link every
    // scoping rule falls through to an unrestricted view.
    await expect(
      runInOrganization(organizationId, () =>
        membershipService.update(userId, { role: "client_admin" }),
      ),
    ).rejects.toBeInstanceOf(ClientCompanyRequiredError);
  });

  it("links a client contact to a company", async () => {
    const updated = await runInOrganization(organizationId, () =>
      membershipService.update(userId, {
        role: "client_admin",
        clientCompanyId,
      }),
    );
    expect(updated?.role).toBe("client_admin");
    expect(updated?.clientCompanyId).toBe(clientCompanyId);
  });

  it("refuses a client company from another organization", async () => {
    // Policy-filtered, so the lookup proves it belongs here rather than
    // merely existing somewhere.
    await expect(
      runInOrganization(organizationId, () =>
        membershipService.update(userId, {
          role: "client_admin",
          clientCompanyId: foreignClientCompanyId,
        }),
      ),
    ).rejects.toBeInstanceOf(UnknownClientCompanyError);
  });

  it("clears the client company when the role becomes agency staff", async () => {
    // A stale link on a promoted account would keep them narrower than their
    // role, which is confusing rather than dangerous — but still wrong.
    const updated = await runInOrganization(organizationId, () =>
      membershipService.update(userId, { role: "hiring_manager" }),
    );
    expect(updated?.clientCompanyId).toBeNull();
  });

  it("refuses a user who is not a member here", async () => {
    await expect(
      runInOrganization(otherOrganizationId, () =>
        membershipService.update(userId, { role: "interviewer" }),
      ),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});

describe("the user list", () => {
  it("carries the role and client company that govern access", async () => {
    const rows = await runInOrganization(organizationId, () =>
      userService.getAll(),
    );
    const target = rows.find((r) => r.id === userId);
    expect(target?.role).toBe("hiring_manager");
    expect(target?.clientCompanyId).toBeNull();
  });

  it("does not list another organization's members", async () => {
    const rows = await runInOrganization(otherOrganizationId, () =>
      userService.getAll(),
    );
    expect(rows.map((r) => r.id)).not.toContain(userId);
  });
});

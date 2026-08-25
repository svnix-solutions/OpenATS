import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runInOrganization } from "../../src/db";
import {
  ClientCompanyInUseError,
  DuplicateSlugError,
  clientCompanyService,
} from "../../src/modules/client-company/client-company.service";
import {
  createScenario,
  createTestOrganization,
  destroyScenario,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `cc-${Date.now()}`;
let organizationId: number;
let otherOrganizationId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
  otherOrganizationId = await createTestOrganization(`${SUFFIX}-other`);
});

afterAll(async () => {
  await dropTestOrganization(otherOrganizationId);
  await dropTestOrganization(organizationId);
});

describe("client companies", () => {
  it("creates one and reads it back", async () => {
    const created = await runInOrganization(organizationId, () =>
      clientCompanyService.create({ name: "Acme Corp", slug: `acme-${SUFFIX}` }),
    );

    expect(created?.name).toBe("Acme Corp");
    // The insert names the organization itself: this table is part of the
    // tenancy skeleton and has no app_current_org() default to fall back on.
    expect(created?.organizationId).toBe(organizationId);
  });

  it("refuses a slug already used in the same organization", async () => {
    await expect(
      runInOrganization(organizationId, () =>
        clientCompanyService.create({ name: "Acme Again", slug: `acme-${SUFFIX}` }),
      ),
    ).rejects.toBeInstanceOf(DuplicateSlugError);
  });

  it("allows the same slug in a different organization", async () => {
    // The unique index is on (organization_id, slug). Two agencies both
    // recruiting for a company called Acme must not collide.
    const created = await runInOrganization(otherOrganizationId, () =>
      clientCompanyService.create({ name: "Acme Corp", slug: `acme-${SUFFIX}` }),
    );
    expect(created?.organizationId).toBe(otherOrganizationId);
  });

  it("does not list another organization's companies", async () => {
    const mine = await runInOrganization(organizationId, () =>
      clientCompanyService.getAll(),
    );
    expect(mine.every((c) => c.organizationId === organizationId)).toBe(true);
    expect(mine.map((c) => c.name)).toContain("Acme Corp");
    expect(mine).toHaveLength(1);
  });

  it("lets an update keep its own slug", async () => {
    const [row] = await runInOrganization(organizationId, () =>
      clientCompanyService.getAll(),
    );

    const updated = await runInOrganization(organizationId, () =>
      clientCompanyService.update(row!.id, {
        name: "Acme Corporation",
        slug: row!.slug,
        website: "https://acme.test",
      }),
    );

    expect(updated?.name).toBe("Acme Corporation");
    expect(updated?.website).toBe("https://acme.test");
  });

  it("refuses to delete one that still has jobs", async () => {
    // createScenario builds a client company that already has two jobs on it,
    // which is exactly the state this refuses. jobs.client_company_id is
    // ON DELETE RESTRICT, so the database would refuse anyway — as a 500.
    // This turns it into something a UI can show.
    const s = await createScenario("cc-inuse");
    try {
      await expect(
        runInOrganization(s.organizationId, () =>
          clientCompanyService.remove(s.clientCompanyId),
        ),
      ).rejects.toBeInstanceOf(ClientCompanyInUseError);
    } finally {
      await destroyScenario(s);
    }
  });

  it("deletes one with no jobs", async () => {
    const [row] = await runInOrganization(organizationId, () =>
      clientCompanyService.getAll(),
    );
    const deleted = await runInOrganization(organizationId, () =>
      clientCompanyService.remove(row!.id),
    );
    expect(deleted?.id).toBe(row!.id);

    const left = await runInOrganization(organizationId, () =>
      clientCompanyService.getAll(),
    );
    expect(left).toHaveLength(0);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, runInOrganization } from "../../src/db";
import { company, departments } from "../../src/db/schema";
import {
  companyService,
  departmentService,
} from "../../src/modules/company/company.service";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `dept-${Date.now()}`;
let orgA: number;
let orgB: number;

async function setUp(organizationId: number, label: string) {
  await runInOrganization(organizationId, async () => {
    await companyService.upsert({
      name: `Company ${label}`,
      email: `${label}.${SUFFIX}@example.test`,
      website: null,
    });
    await departmentService.create({ name: `${label}-Engineering` });
  });
}

beforeAll(async () => {
  orgA = await createTestOrganization(`${SUFFIX}-a`);
  orgB = await createTestOrganization(`${SUFFIX}-b`);
  await setUp(orgA, "ORGA");
  await setUp(orgB, "ORGB");
});

afterAll(async () => {
  await runInOrganization(orgB, () => db.delete(departments));
  await runInOrganization(orgB, () => db.delete(company));
  await runInOrganization(orgA, () => db.delete(departments));
  await runInOrganization(orgA, () => db.delete(company));
  await dropTestOrganization(orgB);
  await dropTestOrganization(orgA);
});

describe("departments are never served across organizations", () => {
  it("gives each organization its own, in either order", async () => {
    // There was a process-wide cache keyed on the literal string "all", so
    // whichever organization asked first was answered to everyone for the
    // next five minutes. Asking twice, alternating, is what exposes it — a
    // single call per organization passes even with the cache in place if
    // they happen to run in the right order.
    const first = await runInOrganization(orgA, () => departmentService.getAll());
    const second = await runInOrganization(orgB, () => departmentService.getAll());
    const third = await runInOrganization(orgA, () => departmentService.getAll());

    expect(first.map((d) => d.name)).toEqual(["ORGA-Engineering"]);
    expect(second.map((d) => d.name)).toEqual(["ORGB-Engineering"]);
    expect(third.map((d) => d.name)).toEqual(["ORGA-Engineering"]);
  });

  it("shows a new department to its own organization and not the other", async () => {
    await runInOrganization(orgB, () =>
      departmentService.create({ name: "ORGB-Sales" }),
    );

    const bNames = (
      await runInOrganization(orgB, () => departmentService.getAll())
    ).map((d) => d.name);
    const aNames = (
      await runInOrganization(orgA, () => departmentService.getAll())
    ).map((d) => d.name);

    expect(bNames).toContain("ORGB-Sales");
    expect(aNames).not.toContain("ORGB-Sales");
  });
});

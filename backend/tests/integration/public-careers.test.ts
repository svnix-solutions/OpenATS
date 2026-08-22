import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { Client } from "pg";
import app from "../../src/app";
import { runInOrganization, db } from "../../src/db";
import { clientCompanies } from "../../src/db/schema/organizations";
import { company, departments } from "../../src/db/schema/company";
import { jobs } from "../../src/db/schema/jobs";
import { users } from "../../src/db/schema/users";
import { organizationMembers } from "../../src/db/schema/organizations";

// The careers page is the one tenant-scoped surface with no session at all.
// Two agencies, each advertising for their own client, is the case that would
// go wrong quietly: a page served from the wrong tenant shows real jobs
// belonging to somebody else.

const SUFFIX = `careers-${Date.now()}`;
let owner: Client;
const orgIds: number[] = [];

async function seedTenant(label: string) {
  const org = await owner.query<{ id: number }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [`Org ${label} ${SUFFIX}`, `${SUFFIX}-${label}`],
  );
  const organizationId = org.rows[0]!.id;
  orgIds.push(organizationId);

  await runInOrganization(organizationId, async () => {
    const [client] = await db
      .insert(clientCompanies)
      .values({
        organizationId,
        name: `Client ${label}`,
        slug: `${SUFFIX}-client-${label}`,
        description: `About client ${label}`,
      })
      .returning({ id: clientCompanies.id });

    const [co] = await db
      .insert(company)
      .values({ name: `Co ${label}`, email: `co.${label}.${SUFFIX}@x.test` })
      .returning({ id: company.id });
    const [dept] = await db
      .insert(departments)
      .values({ companyId: co!.id, name: "Engineering" })
      .returning({ id: departments.id });
    const [user] = await db
      .insert(users)
      .values({
        asgardeoUserId: `${SUFFIX}-${label}`,
        firstName: label,
        lastName: "Owner",
        email: `${label}.${SUFFIX}@x.test`,
      })
      .returning({ id: users.id });
    await db
      .insert(organizationMembers)
      .values({ organizationId, userId: user!.id, role: "recruiter" });

    await db.insert(jobs).values({
      slug: `role-${SUFFIX}`,
      title: `${label} Engineer`,
      clientCompanyId: client!.id,
      departmentId: dept!.id,
      employmentType: "full_time",
      status: "published",
      createdBy: user!.id,
    });
  });

  return `${SUFFIX}-client-${label}`;
}

let slugA: string;
let slugB: string;

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  slugA = await seedTenant("a");
  slugB = await seedTenant("b");
});

afterAll(async () => {
  for (const id of orgIds) {
    await owner.query("DELETE FROM jobs WHERE organization_id = $1", [id]);
    await owner.query("DELETE FROM organization_members WHERE organization_id = $1", [id]);
    await owner.query("DELETE FROM client_companies WHERE organization_id = $1", [id]);
    await owner.query("DELETE FROM departments WHERE organization_id = $1", [id]);
    await owner.query("DELETE FROM company WHERE organization_id = $1", [id]);
    await owner.query("DELETE FROM organizations WHERE id = $1", [id]);
  }
  // After the loop: both tenants' jobs reference users by created_by, so
  // removing them per-tenant orphans the other tenant's foreign keys.
  await owner.query("DELETE FROM users WHERE email LIKE $1", [`%${SUFFIX}%`]);
  await owner.end();
});

describe("GET /public/clients/:clientSlug/jobs", () => {
  it("serves a careers page with no session and no ambiguity", async () => {
    const res = await request(app).get(`/public/clients/${slugA}/jobs`);

    expect(res.status).toBe(200);
    expect(res.body.data.company.name).toBe("Client a");
    expect(res.body.data.jobs).toHaveLength(1);
    expect(res.body.data.jobs[0].title).toBe("a Engineer");
  });

  it("shows each client only its own jobs, with two tenants present", async () => {
    // Both jobs use the same slug and both are published. Nothing about the
    // request says which tenant it is for except the client slug.
    const a = await request(app).get(`/public/clients/${slugA}/jobs`);
    const b = await request(app).get(`/public/clients/${slugB}/jobs`);

    expect(a.body.data.jobs.map((j: { title: string }) => j.title)).toEqual([
      "a Engineer",
    ]);
    expect(b.body.data.jobs.map((j: { title: string }) => j.title)).toEqual([
      "b Engineer",
    ]);
  });

  it("404s an unknown client rather than saying it does not exist", async () => {
    const res = await request(app).get(
      `/public/clients/no-such-client-${SUFFIX}/jobs`,
    );
    expect(res.status).toBe(404);
  });

  it("still works while several organizations exist", async () => {
    // The point of the whole change: the older /public/jobs route cannot
    // answer here, because it has to be told which organization to use.
    const legacy = await request(app).get("/public/jobs");
    expect(legacy.status).toBe(404);

    const scoped = await request(app).get(`/public/clients/${slugA}/jobs`);
    expect(scoped.status).toBe(200);
  });
});

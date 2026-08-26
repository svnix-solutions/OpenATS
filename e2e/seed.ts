import { Client } from "pg";

/**
 * A known world for the E2E specs to walk.
 *
 * Seeded straight into the database as the owner rather than through the API,
 * because creating a job needs an authenticated session and the point of these
 * specs is the candidate-facing pages, which have none.
 *
 * `app.org_id` is set on the connection because row-level security is FORCEd:
 * the owner is subject to it like anyone else, so an insert with no
 * organization set is refused rather than silently unscoped.
 */
const OWNER_URL =
  process.env.MIGRATION_DATABASE_URL ??
  "postgresql://openats:openats@localhost:5433/openats_test";

export type SeededWorld = {
  organizationId: number;
  clientCompanyId: number;
  clientSlug: string;
  jobId: number;
  jobTitle: string;
};

async function withOwner<T>(
  organizationId: number | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: OWNER_URL });
  await client.connect();
  try {
    if (organizationId !== null) {
      await client.query("SELECT set_config('app.org_id', $1, false)", [
        String(organizationId),
      ]);
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function seedWorld(tag: string): Promise<SeededWorld> {
  const suffix = `${tag}-${Date.now()}`;

  // Its own organization, not the one already there. Spec files run in
  // parallel workers, and sharing a tenant meant sharing cleanup: a spec
  // tearing down candidates by email pattern could take another's rows with
  // it mid-run, which showed up as tests intermittently vanishing rather than
  // failing. An organization per world makes each spec's data unreachable
  // from any other and lets teardown be a single cascade.
  //
  // Safe because every page these specs visit is addressed by client slug,
  // which resolves its own tenant. Only the bare /careers URL depends on
  // there being exactly one organization, and nothing asserts that.
  const organizationId = await withOwner(null, async (c) => {
    const r = await c.query<{ id: number }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [`E2E ${suffix}`, suffix],
    );
    return r.rows[0]!.id;
  });

  return withOwner(organizationId, async (c) => {
    const company = await c.query<{ id: number }>(
      "INSERT INTO company (name, email) VALUES ($1, $2) RETURNING id",
      [`Agency ${suffix}`, `agency.${suffix}@example.test`],
    );
    const department = await c.query<{ id: number }>(
      "INSERT INTO departments (company_id, name) VALUES ($1, $2) RETURNING id",
      [company.rows[0]!.id, "Engineering"],
    );
    const author = await c.query<{ id: number }>(
      `INSERT INTO users (asgardeo_user_id, first_name, last_name, email)
       VALUES ($1, 'E2E', 'Author', $2) RETURNING id`,
      [`${suffix}-author`, `author.${suffix}@example.test`],
    );
    const clientCompany = await c.query<{ id: number }>(
      `INSERT INTO client_companies (organization_id, name, slug)
       VALUES ($1, $2, $3) RETURNING id`,
      [organizationId, `Acme ${suffix}`, suffix],
    );

    const jobTitle = "Senior Platform Engineer";
    const job = await c.query<{ id: number }>(
      `INSERT INTO jobs (title, slug, client_company_id, department_id,
                         employment_type, status, description, created_by)
       VALUES ($1, $2, $3, $4, 'full_time', 'published', $5, $6) RETURNING id`,
      [
        jobTitle,
        `job-${suffix}`,
        clientCompany.rows[0]!.id,
        department.rows[0]!.id,
        "We build things that stay built.",
        author.rows[0]!.id,
      ],
    );

    // A job with no pipeline stages cannot take an application, so the apply
    // flow needs at least one.
    await c.query(
      `INSERT INTO job_pipeline_stages (job_id, name, position, stage_type)
       VALUES ($1, 'Applied', 1, 'screening')`,
      [job.rows[0]!.id],
    );

    return {
      organizationId,
      clientCompanyId: clientCompany.rows[0]!.id,
      clientSlug: suffix,
      jobId: job.rows[0]!.id,
      jobTitle,
    };
  });
}

/**
 * Removes the whole world in one go.
 *
 * Everything this seeded hangs off the organization, so deleting that takes
 * the jobs, candidates and applications with it — and cannot reach another
 * spec's rows, which a pattern-matched delete could.
 */
export async function destroyWorld(world: SeededWorld): Promise<void> {
  await withOwner(null, (c) =>
    c.query("DELETE FROM organizations WHERE id = $1", [world.organizationId]),
  );
}

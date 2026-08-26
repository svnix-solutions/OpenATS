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
  clientName: string;
  jobId: number;
  jobTitle: string;
  stageId: number;
  authorId: number;
  candidateName: string;
};

/** The three candidate-facing pages reached by a token rather than a login. */
export type SeededTokens = {
  applicationId: number;
  candidateId: number;
  offerToken: string;
  assessmentToken: string;
  interviewToken: string;
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
      `INSERT INTO users (provider_user_id, first_name, last_name, email)
       VALUES ($1, 'E2E', 'Author', $2) RETURNING id`,
      [`${suffix}-author`, `author.${suffix}@example.test`],
    );
    const clientName = `Acme ${suffix}`;
    const clientCompany = await c.query<{ id: number }>(
      `INSERT INTO client_companies (organization_id, name, slug)
       VALUES ($1, $2, $3) RETURNING id`,
      [organizationId, clientName, suffix],
    );

    // Unique per world. A shared constant made "the other agency's job is not
    // visible" unfalsifiable: the string it looked for was also this world's
    // own job title, so the assertion could only ever pass.
    const jobTitle = `Senior Platform Engineer ${suffix}`;
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

    const stage = await c.query<{ id: number }>(
      "SELECT id FROM job_pipeline_stages WHERE job_id = $1 LIMIT 1",
      [job.rows[0]!.id],
    );

    return {
      organizationId,
      clientCompanyId: clientCompany.rows[0]!.id,
      clientSlug: suffix,
      clientName,
      jobId: job.rows[0]!.id,
      jobTitle,
      stageId: stage.rows[0]!.id,
      authorId: author.rows[0]!.id,
      candidateName: "Ada Lovelace",
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

/**
 * A candidate who already has an offer, an assessment invite and an interview
 * to confirm — the three pages reached by a token rather than a login.
 *
 * Seeded rather than driven through the dashboard, because creating any of
 * them needs an authenticated agency session and these specs are about what
 * the candidate sees.
 */
export async function seedTokenPages(
  world: SeededWorld,
): Promise<SeededTokens> {
  const stamp = Date.now();

  return withOwner(world.organizationId, async (c) => {
    const candidate = await c.query<{ id: number }>(
      `INSERT INTO candidates (first_name, last_name, email, phone)
       VALUES ('Ada', 'Lovelace', $1, '+15550000009') RETURNING id`,
      [`ada.tokens.${stamp}@example.test`],
    );
    const application = await c.query<{ id: number }>(
      `INSERT INTO applications (candidate_id, job_id, current_stage_id, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [candidate.rows[0]!.id, world.jobId, world.stageId],
    );

    // "sent", because a draft offer has nothing for a candidate to open.
    const offerToken = `offer-${stamp}`;
    await c.query(
      `INSERT INTO offers (candidate_id, job_id, created_by, status, salary,
                           currency, employment_type, start_date,
                           reporting_manager, benefits, offer_letter_html,
                           review_token, sent_at)
       VALUES ($1, $2, $3, 'sent', 120000, 'USD', 'full_time', '2026-10-01',
               'Jane Manager', 'Health, dental', '<p>We are pleased to offer…</p>',
               $4, now())`,
      [candidate.rows[0]!.id, world.jobId, world.authorId, offerToken],
    );

    const assessment = await c.query<{ id: number }>(
      `INSERT INTO assessments (title, description, time_limit, created_by)
       VALUES ('Technical Screen', 'A short exercise', 45, $1) RETURNING id`,
      [String(world.authorId)],
    );
    await c.query(
      `INSERT INTO assessment_questions (assessment_id, title, description,
                                         question_type, points, position)
       VALUES ($1, 'What is 2 + 2?', '', 'short_answer', 10, 1)`,
      [assessment.rows[0]!.id],
    );

    const assessmentToken = `assess-${stamp}`;
    await c.query(
      `INSERT INTO candidate_assessment_attempts
         (assessment_id, application_id, token, expires_at, status)
       VALUES ($1, $2, $3, now() + interval '7 days', 'pending')`,
      [assessment.rows[0]!.id, application.rows[0]!.id, assessmentToken],
    );

    const interviewToken = `interview-${stamp}`;
    await c.query(
      `INSERT INTO candidate_interviews
         (candidate_id, stage_id, job_id, event_name, event_type, meeting_url,
          status, public_token, time_slots)
       VALUES ($1, $2, $3, 'Technical Interview', 'virtual',
               'https://meet.example.test/abc', 'pending', $4, $5::jsonb)`,
      [
        candidate.rows[0]!.id,
        world.stageId,
        world.jobId,
        interviewToken,
        JSON.stringify([
          { datetime: "2026-11-10T10:00:00.000Z", selected: false },
          { datetime: "2026-11-11T14:00:00.000Z", selected: false },
        ]),
      ],
    );

    return {
      applicationId: application.rows[0]!.id,
      candidateId: candidate.rows[0]!.id,
      offerToken,
      assessmentToken,
      interviewToken,
    };
  });
}

/**
 * Someone who has applied, so the dashboard's candidate list has a row in it.
 *
 * A person and an application are two rows on purpose: `candidates` is the
 * person, `applications` is their submission to one job, and the dashboard
 * lists the latter.
 */
export async function seedApplicant(
  world: SeededWorld,
): Promise<{ name: string; applicationId: number }> {
  const stamp = Date.now();
  const first = "Grace";
  const last = `Hopper${stamp % 10000}`;

  return withOwner(world.organizationId, async (c) => {
    const candidate = await c.query<{ id: number }>(
      `INSERT INTO candidates (first_name, last_name, email, phone)
       VALUES ($1, $2, $3, '+15550000010') RETURNING id`,
      [first, last, `grace.${stamp}@example.test`],
    );
    const application = await c.query<{ id: number }>(
      `INSERT INTO applications (candidate_id, job_id, current_stage_id, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [candidate.rows[0]!.id, world.jobId, world.stageId],
    );
    return {
      name: `${first} ${last}`,
      applicationId: application.rows[0]!.id,
    };
  });
}

/**
 * A second client company in the same organization, with its own job.
 *
 * Scoping is only demonstrable when there is something to be scoped out of. A
 * client contact seeing "their" job proves nothing if it is the only job the
 * agency has.
 */
export async function seedSecondClient(
  world: SeededWorld,
): Promise<{ clientSlug: string; jobTitle: string; jobId: number }> {
  const stamp = Date.now();
  const slug = `other-${world.clientSlug}`;

  return withOwner(world.organizationId, async (c) => {
    const client = await c.query<{ id: number }>(
      `INSERT INTO client_companies (organization_id, name, slug)
       VALUES ($1, $2, $3) RETURNING id`,
      [world.organizationId, `Rival ${stamp}`, slug],
    );
    // The department of this world's own job, not "any department".
    //
    // This connection is the owner, which is a superuser, so row-level
    // security does not scope it — an unqualified LIMIT 1 picked up another
    // spec's department, and the rival job then held a foreign key into a
    // world it did not own. That world's teardown failed with a constraint
    // violation, in a different spec file, long after the cause.
    const department = await c.query<{ id: number }>(
      "SELECT department_id AS id FROM jobs WHERE id = $1",
      [world.jobId],
    );
    const jobTitle = `Rival Engineer ${stamp}`;
    const job = await c.query<{ id: number }>(
      `INSERT INTO jobs (title, slug, client_company_id, department_id,
                         employment_type, status, description, created_by)
       VALUES ($1, $2, $3, $4, 'full_time', 'published', $5, $6) RETURNING id`,
      [
        jobTitle,
        `rival-job-${stamp}`,
        client.rows[0]!.id,
        department.rows[0]!.id,
        "Someone else's opening.",
        world.authorId,
      ],
    );
    return { clientSlug: slug, jobTitle, jobId: job.rows[0]!.id };
  });
}

import "dotenv/config";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { db, runInOrganization } from "./index";
import { pipelineStageTemplates, templates } from "./schema";
import logger from "../utils/logger";

/**
 * Stage templates belong to an organization now, so seeding has to say which.
 *
 * Refuses rather than guesses when there is more than one, for the same reason
 * first login does: putting defaults in the wrong tenant is worse than not
 * seeding. Pass SEED_ORGANIZATION_ID to be explicit.
 *
 * The lookup runs on the migration role, not the application one. `unscopedDb`
 * bypasses the request-scoped proxy but is still subject to row-level
 * security, so outside an organization context it sees no organizations —
 * which is the correct behaviour and made this refuse with "No organization
 * exists to seed into" on an install that plainly had one. `make seed`, and
 * therefore `make setup`, could not complete at all.
 */
async function resolveOrganization(): Promise<number> {
  const explicit = process.env.SEED_ORGANIZATION_ID;
  if (explicit) return Number(explicit);

  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required: finding the organization to seed " +
        "reads a table the application role cannot see outside a request.",
    );
  }

  const owner = new Client({ connectionString });
  await owner.connect();
  try {
    const result = await owner.query<{ id: number; total: number }>(
      `SELECT id, (SELECT count(*)::int FROM organizations) AS total
       FROM organizations ORDER BY id LIMIT 1`,
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("No organization exists to seed into.");
    }
    if (row.total > 1) {
      throw new Error(
        `${row.total} organizations exist. Set SEED_ORGANIZATION_ID to choose one.`,
      );
    }
    return row.id;
  } finally {
    await owner.end();
  }
}

async function seed() {
  console.log("Seeding pipeline stage templates...");
  const organizationId = await resolveOrganization();
  await runInOrganization(organizationId, seedTemplates);
  // Exit after the transaction commits, not from inside it.
  process.exit(0);
}

/**
 * The stages a new organization starts with. Shared with provision-org.ts so
 * a stage added here reaches organizations created later, rather than only
 * the one this script seeds.
 */
export const DEFAULT_STAGE_TEMPLATES = [
  { name: "Screening", position: 1, stageType: "screening", isDeletable: false },
  {
    name: "Screening Qualified",
    position: 2,
    stageType: "screening",
    isDeletable: false,
  },
  {
    name: "Screening Disqualified",
    position: 3,
    stageType: "screening",
    isDeletable: false,
  },
  { name: "Interviews", position: 4, stageType: "interview", isDeletable: false },
  { name: "Shortlisted", position: 5, stageType: "interview", isDeletable: false },
  { name: "Offer", position: 6, stageType: "offer", isDeletable: false },
  { name: "Hired", position: 7, stageType: "offer", isDeletable: false },
] as const;

/**
 * The email templates an organization starts with.
 *
 * Without at least these two the product cannot send anything to a candidate:
 * an offer needs `offer_letter_html`, which is rendered from a template, so
 * with none an offer can be drafted and never sent; and the rejection dialog
 * refuses to send an email without a template to render. Both of the
 * candidate-facing emails were unreachable on a fresh install.
 *
 * Email templates are stored as a plain HTML string — `{{variables}}` are
 * filled by template-engine.service, and an unknown one is left untouched
 * rather than blanked, so editing these later cannot silently empty a letter.
 *
 * They are a starting point, not a prescription: every one is editable in
 * Settings → Templates, and nothing re-seeds over an edit.
 */
export const DEFAULT_EMAIL_TEMPLATES = [
  {
    name: "Offer Letter",
    type: "email" as const,
    subject: "Your offer from {{company_name}}",
    bodyJson: [
      "<p>Dear {{candidate_name}},</p>",
      "<p>We are delighted to offer you the position of <strong>{{job_title}}</strong> at {{company_name}}.</p>",
      "<ul>",
      "<li><strong>Salary:</strong> {{salary}} {{currency}}</li>",
      "<li><strong>Employment type:</strong> {{employment_type}}</li>",
      "<li><strong>Start date:</strong> {{start_date}}</li>",
      "<li><strong>Reporting to:</strong> {{reporting_manager}}</li>",
      "<li><strong>Benefits:</strong> {{benefits}}</li>",
      "</ul>",
      // No review link here. This template renders `offers.offer_letter_html`,
      // which is the letter shown *on* the review page — a link back to the
      // page the reader is already looking at. The email that carries the
      // candidate there is built separately in offer.service and already has
      // it. `{{offer_review_url}}` is still available to anyone who wants it
      // in a template of their own.
      "<p>You can accept or decline using the buttons on this page.</p>",
      "<p>We are looking forward to hearing from you.</p>",
      "<p>{{company_name}}</p>",
    ].join("\n"),
  },
  {
    name: "Rejection",
    type: "email" as const,
    subject: "Your application to {{company_name}}",
    bodyJson: [
      "<p>Dear {{candidate_name}},</p>",
      "<p>Thank you for taking the time to apply for <strong>{{job_title}}</strong> and for the interest you have shown in {{company_name}}.</p>",
      "<p>After careful consideration we have decided not to move forward with your application on this occasion.</p>",
      "<p>We would be glad to hear from you about future openings, and we wish you well with your search.</p>",
      "<p>{{company_name}}</p>",
    ].join("\n"),
  },
];

export async function seedTemplates() {
  await db.delete(pipelineStageTemplates);
  await db.insert(pipelineStageTemplates).values([...DEFAULT_STAGE_TEMPLATES]);

  logger.info("Pipeline stage templates seeded (7 default stages).");

  await seedEmailTemplates();
}

/**
 * Adds any missing default email template, and touches nothing else.
 *
 * Deliberately not a delete-and-replace like the stage templates above: these
 * are edited. Someone rewrites the offer letter in their own words, runs the
 * seed again for an unrelated reason, and it is gone. Matching on name means
 * re-running is a no-op once they exist, and an organization that has renamed
 * one simply gets a fresh copy alongside rather than losing their version.
 */
export async function seedEmailTemplates() {
  const existing = await db
    .select({ name: templates.name })
    .from(templates)
    .where(eq(templates.type, "email"));
  const have = new Set(existing.map((t) => t.name));

  const missing = DEFAULT_EMAIL_TEMPLATES.filter((t) => !have.has(t.name));
  if (missing.length === 0) {
    logger.info("Email templates already present; nothing seeded.");
    return;
  }

  // createdBy stays null: nobody wrote these.
  await db.insert(templates).values(missing);
  logger.info(
    `Email templates seeded (${missing.map((t) => t.name).join(", ")}).`,
  );
}

// Only when run directly. provision-org.ts imports seedTemplates to give a
// new organization the same stages, and must not trigger a seed of its own.
if (require.main === module) {
  seed().catch((err) => {
    logger.error("Seed failed:", err);
    process.exit(1);
  });
}

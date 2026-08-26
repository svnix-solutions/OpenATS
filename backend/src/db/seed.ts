import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, runInOrganization, unscopedDb } from "./index";
import { pipelineStageTemplates } from "./schema";
import logger from "../utils/logger";

/**
 * Stage templates belong to an organization now, so seeding has to say which.
 *
 * Refuses rather than guesses when there is more than one, for the same reason
 * first login does: putting defaults in the wrong tenant is worse than not
 * seeding. Pass SEED_ORGANIZATION_ID to be explicit.
 */
async function resolveOrganization(): Promise<number> {
  const explicit = process.env.SEED_ORGANIZATION_ID;
  if (explicit) return Number(explicit);

  const result = await unscopedDb.execute<{ id: number; total: number }>(
    sql`SELECT id, (SELECT count(*)::int FROM organizations) AS total
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

export async function seedTemplates() {
  await db.delete(pipelineStageTemplates);
  await db.insert(pipelineStageTemplates).values([...DEFAULT_STAGE_TEMPLATES]);

  logger.info("Pipeline stage templates seeded (7 default stages).");
}

// Only when run directly. provision-org.ts imports seedTemplates to give a
// new organization the same stages, and must not trigger a seed of its own.
if (require.main === module) {
  seed().catch((err) => {
    logger.error("Seed failed:", err);
    process.exit(1);
  });
}

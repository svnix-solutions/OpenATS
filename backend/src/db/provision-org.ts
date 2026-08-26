import "dotenv/config";
import { Client } from "pg";
import { DEFAULT_STAGE_TEMPLATES } from "./seed";
import logger from "../utils/logger";

/**
 * Creates a new organization — a new recruiting agency on this install.
 *
 * This is an operator command, not an API, and that is deliberate. The policy
 * on `organizations` is `id = app_current_org()`, so its WITH CHECK can never
 * pass for a row that does not exist yet: no request context can create a
 * tenant. There is also no role to authorize it with, since `super_admin`
 * lives in `organization_members` and is therefore scoped to one organization.
 * An endpoint would need a cross-tenant privilege that does not exist, and
 * inventing one would be a hole in the boundary rather than a feature.
 *
 * So it runs as the migration role, the same way migrations do, and is reached
 * by whoever holds that connection string.
 *
 *   pnpm provision-org --name "Acme Recruiting" --slug acme \
 *     [--provider-org-id <claim>] [--admin someone@acme.test]
 */

export type Args = {
  name: string;
  slug: string;
  providerOrgId: string | null;
  admin: string | null;
};

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };

  const name = get("--name");
  const slug = get("--slug");
  if (!name || !slug) {
    throw new Error(
      'Usage: pnpm provision-org --name "Acme Recruiting" --slug acme ' +
        "[--provider-org-id <claim>] [--admin someone@acme.test]",
    );
  }
  // The slug reaches users as a careers-page URL and is resolved by
  // app_resolve_org_by_client_slug, so keep it to what survives a URL.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": use lowercase letters, digits and hyphens.`,
    );
  }
  return {
    name,
    slug,
    providerOrgId: get("--provider-org-id"),
    admin: get("--admin"),
  };
}

/**
 * Everything runs on the owner connection, in one transaction.
 *
 * The owner because `openats_app` has FORCE ROW LEVEL SECURITY: outside an
 * organization context every policy sees a null organization and the insert is
 * refused, correctly. One transaction because the first version of this script
 * created the organization on the owner connection and seeded its stages on
 * the app connection — when the second step failed it left a tenant with no
 * stages and no members, which is worse than no tenant at all.
 */
async function withOwnerTransaction<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required: creating an organization runs as " +
        "the owner, because row-level security refuses it to the app role.",
    );
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

export async function provision(args: Args): Promise<void> {
  const organizationId = await withOwnerTransaction(async (client) => {
    const existing = await client.query<{ id: number }>(
      "SELECT id FROM organizations WHERE slug = $1",
      [args.slug],
    );
    if (existing.rows[0]) {
      throw new Error(
        `An organization with slug "${args.slug}" already exists (id ${existing.rows[0].id}).`,
      );
    }

    const created = await client.query<{ id: number }>(
      `INSERT INTO organizations (name, slug, provider_org_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [args.name, args.slug, args.providerOrgId],
    );
    const id = created.rows[0]!.id;

    // organization_id has a DEFAULT of app_current_org(), which is null here,
    // so unlike every service query this one has to say which tenant it means.
    for (const stage of DEFAULT_STAGE_TEMPLATES) {
      await client.query(
        `INSERT INTO pipeline_stage_templates
           (organization_id, name, position, stage_type, is_deletable)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, stage.name, stage.position, stage.stageType, stage.isDeletable],
      );
    }

    if (args.admin) {
      await attachAdmin(client, id, args.admin, args.slug);
    }
    return id;
  });

  logger.info(
    `Organization "${args.name}" created (id ${organizationId}, slug ${args.slug}) ` +
      `with ${DEFAULT_STAGE_TEMPLATES.length} pipeline stages.`,
  );
  if (!args.admin) {
    logger.warn(
      "No --admin given, and nobody can reach this organization yet: " +
        "app_attach_default_membership attaches a new user only when exactly " +
        "one organization exists, so sign-ins will be refused with 403 until " +
        "someone is placed here.",
    );
  }
}

/**
 * Places the first administrator, who has usually never signed in.
 *
 * `app_provision_user` looks a user up by provider subject and falls back to
 * reconciling by email when the subject is unknown — the branch that handles a
 * provider re-issuing a `sub`. A placeholder subject rides on that: the row
 * exists so a membership can point at it, and the first real sign-in replaces
 * the placeholder with the true subject.
 */
async function attachAdmin(
  client: Client,
  organizationId: number,
  email: string,
  slug: string,
): Promise<void> {
  const found = await client.query<{ id: number }>(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );

  const userId =
    found.rows[0]?.id ??
    (
      await client.query<{ id: number }>(
        `INSERT INTO users (provider_user_id, email, first_name, last_name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [`pending:${slug}:${email}`, email, "Pending", "Admin"],
      )
    ).rows[0]!.id;

  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'super_admin')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'super_admin'`,
    [organizationId, userId],
  );

  logger.info(`${email} attached as super_admin of organization ${organizationId}.`);
}

if (require.main === module) {
  // parseArgs inside the chain, not as an argument to it: thrown out here it
  // would escape the catch below and print a stack trace instead of the usage.
  Promise.resolve()
    .then(() => provision(parseArgs(process.argv.slice(2))))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error(
        `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    });
}

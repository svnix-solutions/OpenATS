import { Client } from "pg";

/**
 * Removes worlds left behind by an interrupted or failed run.
 *
 * Teardown deletes the organization it created, but a run that dies — or whose
 * teardown throws — leaves one behind, and the next run then starts against a
 * database that already has other tenants in it. That is not hypothetical:
 * an unscoped fixture query took a foreign key on another world's department,
 * the resulting constraint violation broke teardown, and every subsequent run
 * failed for reasons that had nothing to do with the change being tested.
 *
 * Matching on the name every seeded world uses, so nothing else can be caught
 * by it — and only ever against the test database on 5433.
 */
export default async function globalSetup(): Promise<void> {
  // One spec sends a real email and asserts the history the server returns.
  // Without a catcher the send fails, nothing is recorded — correctly, since a
  // history entry claims somebody was contacted — and the spec fails looking
  // like a broken feature rather than a missing container. Say which it is.
  if (!process.env.SMTP_HOST) {
    console.warn(
      "[e2e] SMTP_HOST is unset, so mail cannot be sent and the email specs " +
        "will fail. Run `docker compose up -d mailpit` and set " +
        "SMTP_HOST=localhost in backend/.env.",
    );
  }

  const client = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ??
      "postgresql://openats:openats@localhost:5433/openats_test",
  });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      "DELETE FROM organizations WHERE name LIKE 'E2E %'",
    );
    if (rowCount) {
      console.log(`[e2e] removed ${rowCount} world(s) left by an earlier run`);
    }
  } finally {
    await client.end();
  }
}

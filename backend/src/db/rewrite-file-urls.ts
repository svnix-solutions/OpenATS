/**
 * Repoints stored file URLs at a new R2_PUBLIC_URL.
 *
 * Needed once, when a bucket stops being publicly readable and the API starts
 * brokering reads. The rows hold whole URLs rather than keys, so the base in
 * them is whatever it was on the day each file was uploaded — and every one of
 * those URLs 403s the moment the bucket goes private.
 *
 * Runs as the migration role, like the seed and provisioning, and for the same
 * reason: it has to see every organization's rows, and the application role
 * correctly sees none outside a request.
 *
 *   pnpm tsx src/db/rewrite-file-urls.ts            # report, change nothing
 *   pnpm tsx src/db/rewrite-file-urls.ts --apply
 */
import "dotenv/config";
import { Client } from "pg";

/** The columns holding a URL to an object in the bucket. */
const TARGETS = [
  { table: "candidates", column: "resume_url" },
  { table: "client_companies", column: "logo_url" },
  { table: "company", column: "logo_url" },
] as const;

/** `logos/<uuid>.png` off the end of a URL, whatever came before it. */
const KEY_PATTERN = /(resumes|logos)\/[0-9a-f-]{36}\.[a-z]{3,4}$/;

function base(): string {
  const value = process.env.R2_PUBLIC_URL;
  if (!value) throw new Error("R2_PUBLIC_URL is not set");
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const target = base();

  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL is not set. This has to run as the owner: it " +
        "rewrites every organization's rows, and row-level security hides " +
        "them all from the application role outside a request.",
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  let changed = 0;
  let skipped = 0;
  try {
    for (const { table, column } of TARGETS) {
      const { rows } = await client.query<{ id: number; value: string }>(
        `SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`,
      );

      for (const row of rows) {
        const match = KEY_PATTERN.exec(row.value);
        if (!match) {
          // Not a URL this application wrote. Left alone rather than guessed
          // at — an unrecognised value is worth a human looking at it.
          console.warn(`  ? ${table}#${row.id}: no object key in ${row.value}`);
          skipped += 1;
          continue;
        }

        const next = `${target}/${match[0]}`;
        if (next === row.value) continue;

        console.log(`  ${apply ? "→" : "would"} ${table}#${row.id}: ${next}`);
        if (apply) {
          await client.query(
            `UPDATE ${table} SET ${column} = $1 WHERE id = $2`,
            [next, row.id],
          );
        }
        changed += 1;
      }
    }
  } finally {
    await client.end();
  }

  console.log(
    apply
      ? `\nRewrote ${changed} URL(s) to ${target}.`
      : `\n${changed} URL(s) would change. Re-run with --apply.`,
  );
  if (skipped) console.log(`${skipped} value(s) left alone; see the warnings above.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

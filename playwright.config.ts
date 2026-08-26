import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";

// The authenticated specs create their user in the identity provider, which
// needs its URL and admin secret. Those live in frontend/.env, which Playwright
// does not read on its own — and dotenv is not a dependency of this package,
// which only exists to hold the E2E suite.
for (const line of readFileSync("frontend/.env", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) process.env[match[1]!] ??= match[2]!.replace(/^["']|["']$/g, "");
}

// `openats_app`, not `openats`. The owner of this database is a superuser, and
// a superuser bypasses row-level security even where it is FORCEd — so a
// backend connected as `openats` serves every tenant's rows to every other
// one, silently, and any isolation test passes without testing anything.
// That was the case here until an authenticated spec looked at a second
// organization's jobs and found them.
const TEST_DATABASE_URL =
  "postgresql://openats_app:openats_app@localhost:5433/openats_test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    // `pnpm test:e2e` clears frontend/.next first, and the suite is not
    // repeatable without it: `next dev` persists route results on disk, so a
    // /careers/:slug that 404'd on one run — before that run seeded its client
    // company — kept 404ing on the next, while the same data served fine over
    // the API. Dev only; every careers route builds as dynamic in production.
    command: "pnpm dev",
    url: "http://localhost:3000",
    // Playwright must own the servers so DATABASE_URL below actually applies.
    // With reuse enabled, an already-running `make dev` would be adopted
    // instead — silently pointing the whole suite at the dev database.
    reuseExistingServer: false,
    // dotenv does not override existing process.env, so this wins over
    // backend/.env and keeps E2E writes out of the dev database.
    env: { DATABASE_URL: TEST_DATABASE_URL },
    timeout: 120_000,
  },
});

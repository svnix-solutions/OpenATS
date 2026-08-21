import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations need the owner role; the application connects as a
    // least-privileged role that cannot create tables or drop policies.
    // Falls back to DATABASE_URL so a single-role setup still works.
    url: (process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL)!,
  },
});

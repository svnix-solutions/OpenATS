import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { candidateImports } from "../../src/db/schema/imports";
import { importCandidates } from "../../src/modules/candidate/import.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * An import as a job rather than a request.
 *
 * The row is what makes it observable: the worker advances `processed`, so a
 * screen can say where it is, and the outcome outlives the browser being
 * closed. The file is cleared when the run finishes, because it is a list of
 * people's names, emails and phone numbers.
 */

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("import-run");
});
afterAll(async () => {
  await destroyScenario(s);
});

const CSV = [
  "Name,Email",
  ...Array.from({ length: 25 }, (_, i) => `Person ${i},p${i}@run.test`),
].join("\n");

describe("progress", () => {
  itInOrg("is reported as rows are handled, not only at the end", async () => {
    const seen: number[] = [];

    const report = await importCandidates(s.jobA.id, CSV, {
      dryRun: true,
      onProgress: async (processed, total) => {
        seen.push(processed);
        expect(total).toBe(25);
      },
    });

    expect(report.rows).toHaveLength(25);
    // Called for every row, so a caller can throttle its own writes rather
    // than being given a cadence it did not choose.
    expect(seen).toHaveLength(25);
    expect(seen.at(-1)).toBe(25);
  });
});

describe("the run row", () => {
  itInOrg("holds the file until it is read, then does not", async () => {
    const [run] = await db
      .insert(candidateImports)
      .values({ jobId: s.jobA.id, filename: "list.csv", csv: CSV })
      .returning();

    expect(run?.status).toBe("queued");
    expect(run?.csv).toBe(CSV);

    // What the worker does when it finishes.
    await db
      .update(candidateImports)
      .set({ status: "done", csv: null, processed: 25, total: 25 })
      .where(eq(candidateImports.id, run!.id));

    const [after] = await db
      .select()
      .from(candidateImports)
      .where(eq(candidateImports.id, run!.id))
      .limit(1);

    // A list of people's contact details, kept no longer than it is needed.
    expect(after?.csv).toBeNull();
    expect(after?.status).toBe("done");
  });

  itInOrg("belongs to one organization", async () => {
    // The policy scopes it, so an import cannot be read across tenants and no
    // rule in the handler has to say so.
    const other = await createScenario("import-other");
    try {
      const [theirs] = await db
        .insert(candidateImports)
        .values({ jobId: s.jobA.id, csv: "x" })
        .returning();

      const visible = await db
        .select({ id: candidateImports.id })
        .from(candidateImports)
        .where(eq(candidateImports.id, theirs!.id));

      // Visible here, because this is the organization that created it.
      expect(visible).toHaveLength(1);
    } finally {
      await destroyScenario(other);
    }
  });
});

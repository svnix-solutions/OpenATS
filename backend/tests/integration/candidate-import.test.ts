import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { applications, candidates } from "../../src/db/schema/candidates";
import { importCandidates } from "../../src/modules/candidate/import.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * Bulk import of a recruiter's existing list.
 *
 * The hard part is not parsing. It is what a file does when part of it is
 * wrong: rejecting all of it costs five hundred good rows for one typo, and
 * importing part of it leaves the file and the system disagreeing with nobody
 * able to say which rows landed.
 */

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("import");
});
afterAll(async () => {
  await destroyScenario(s);
});

const GOOD = [
  "First Name,Last Name,Email,Phone",
  "Ada,Lovelace,ada@example.test,+49301111111",
  "Grace,Hopper,grace@example.test,",
].join("\n");

describe("a dry run", () => {
  itInOrg("reports what would happen and writes nothing", async () => {
    const report = await importCandidates(s.jobA.id, GOOD, { dryRun: true });

    expect(report.counts.would_import).toBe(2);

    const [found] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.email, "ada@example.test"))
      .limit(1);
    expect(found).toBeUndefined();
  });
});

describe("a real run", () => {
  itInOrg("imports the good rows", async () => {
    const report = await importCandidates(s.jobA.id, GOOD, { dryRun: false });
    expect(report.counts.imported).toBe(2);
  });

  itInOrg("is safe to run again on the same file", async () => {
    // What a corrected file re-uploaded looks like. Rows already in must come
    // back as already-on-job rather than errors, and must not duplicate.
    const report = await importCandidates(s.jobA.id, GOOD, { dryRun: false });
    expect(report.counts.already_on_job).toBe(2);
    expect(report.counts.imported).toBeUndefined();
  });
});

describe("the same list against a second job", () => {
  itInOrg("attaches the same people rather than creating new ones", async () => {
    // The workflow this exists for: import a list once, then put those same
    // people on other roles as they come up. Doing that one at a time
    // afterwards is what a recruiter would otherwise be stuck with.
    const before = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.email, "ada@example.test"));

    const report = await importCandidates(s.jobB.id, GOOD, { dryRun: false });
    expect(report.counts.imported).toBe(2);

    const after = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.email, "ada@example.test"));

    // One person, two submissions. A second person would split their history
    // and give them two conversations.
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);

    const submissions = await db
      .select({ jobId: applications.jobId })
      .from(applications)
      .where(eq(applications.candidateId, after[0]!.id));
    expect(submissions.map((r) => r.jobId).sort()).toEqual(
      [s.jobA.id, s.jobB.id].sort(),
    );
  });
});

describe("rows that are wrong", () => {
  itInOrg("reports each bad row by its spreadsheet line", async () => {
    const csv = [
      "Name,Email",
      "No Email,",                       // line 2
      "Bad Address,not-an-email",        // line 3
      ",orphan@example.test",            // line 4
      "Twice Over,twice@example.test",   // line 5
      "Twice Again,twice@example.test",  // line 6
    ].join("\n");

    const report = await importCandidates(s.jobB.id, csv, { dryRun: true });
    const byLine = Object.fromEntries(report.rows.map((r) => [r.line, r.outcome]));

    expect(byLine).toEqual({
      2: "missing_email",
      3: "invalid_email",
      4: "missing_name",
      5: "would_import",
      6: "duplicate_in_file",
    });
  });

  itInOrg("still imports the good rows around them", async () => {
    const csv = [
      "Name,Email",
      "Broken,not-an-email",
      "Fine Person,fine@example.test",
    ].join("\n");

    const report = await importCandidates(s.jobB.id, csv, { dryRun: false });
    expect(report.counts.imported).toBe(1);
    expect(report.counts.invalid_email).toBe(1);
  });
});

describe("files as they actually arrive", () => {
  itInOrg("survives a BOM, CRLF, quoted commas and a single-word name", async () => {
    // Every one of these comes out of Excel or LinkedIn without asking.
    const csv =
      "﻿full name,e-mail\r\n" +
      '"Turing, Alan",alan@example.test\r\n' +
      "Cher,cher@example.test\r\n";

    const report = await importCandidates(s.jobB.id, csv, { dryRun: true });
    expect(report.counts.would_import).toBe(2);

    // "Turing, Alan" is one field, not two — and it is Last, First, which is
    // how LinkedIn and most spreadsheets write a name. Read left to right it
    // would give someone a first name with a comma on the end.
    expect(report.rows.map((r) => [r.firstName, r.lastName])).toEqual([
      ["Alan", "Turing"],
      // A mononym is a first name, not a missing one.
      ["Cher", null],
    ]);
  });
});

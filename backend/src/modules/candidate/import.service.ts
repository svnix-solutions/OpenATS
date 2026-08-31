import { parse } from "csv-parse/sync";
import { candidateService } from "./candidate.service";
import { DuplicateApplicationError } from "./candidate.service";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * Importing a list of people a recruiter already has.
 *
 * The awkward part of bulk is not parsing, it is what happens when row 7 is
 * wrong. Rejecting the whole file means one typo costs five hundred good rows;
 * importing what works means the file and the system disagree afterwards, and
 * nobody can tell which rows landed.
 *
 * So: the same pass runs twice. A dry run reports exactly what would happen
 * without writing, and the real run reports what did. Because it is literally
 * the same code, the preview cannot promise something the import then does
 * differently — which is the failure a separate validator always eventually
 * has.
 *
 * Re-uploading a corrected file is safe. A person already on the job comes
 * back as `already_on_job`, not an error, so fixing row 7 and sending the
 * whole file again does not duplicate rows 1 to 6.
 */

/** What one row turned into. */
export type ImportOutcome =
  | "imported"
  | "would_import"
  | "already_on_job"
  | "duplicate_in_file"
  | "missing_email"
  | "invalid_email"
  | "missing_name"
  | "failed";

export type ImportRow = {
  /** 1-based, counting the header, so it matches what a spreadsheet shows. */
  line: number;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  outcome: ImportOutcome;
  /** Only for `failed`, where the reason is not implied by the outcome. */
  detail?: string;
};

export type ImportReport = {
  rows: ImportRow[];
  counts: Record<string, number>;
};

/**
 * Headers we understand, and the spellings people actually use.
 *
 * A recruiter's file comes out of LinkedIn, a spreadsheet, or another ATS, and
 * none of them agree on capitalisation or wording. Matching loosely here costs
 * nothing and saves the person editing a header row by hand.
 */
const HEADERS: Record<string, string[]> = {
  email: ["email", "e-mail", "email address", "mail"],
  firstName: ["first name", "firstname", "first", "given name"],
  lastName: ["last name", "lastname", "last", "surname", "family name"],
  fullName: ["name", "full name", "candidate", "candidate name"],
  phone: ["phone", "phone number", "mobile", "telephone", "contact number"],
};

function normaliseKey(header: string): string | null {
  const key = header.trim().toLowerCase();
  for (const [field, spellings] of Object.entries(HEADERS)) {
    if (spellings.includes(key)) return field;
  }
  return null;
}

/** Deliberately loose. Bouncing a real address is worse than accepting a bad one. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One name field into two.
 *
 * A comma means the export wrote it as "Last, First" — LinkedIn and most
 * spreadsheets do — and reading that left to right gives someone a first name
 * with a comma stuck on the end. Without a comma the last word is the surname,
 * which is wrong for some names and right for most, and there is no way to
 * tell from the string alone.
 *
 * A single word is a first name, not a missing one. Mononyms exist and a row
 * that has an email is worth importing.
 */
function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();

  const comma = trimmed.indexOf(",");
  if (comma !== -1) {
    const lastName = trimmed.slice(0, comma).trim();
    const firstName = trimmed.slice(comma + 1).trim();
    if (firstName) return { firstName, lastName };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1)!,
  };
}

export async function importCandidates(
  jobId: number,
  csv: string,
  { dryRun }: { dryRun: boolean },
): Promise<ImportReport> {
  const parsed = parse(csv, {
    columns: (header: string[]) =>
      header.map((h) => normaliseKey(h) ?? `_${h.trim()}`),
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: ImportRow[] = [];
  // Within one file, not across the database: two rows for the same person is
  // a mistake in the file, and worth saying so rather than reporting the
  // second as "already on this job" once the first has gone in.
  const seen = new Set<string>();

  for (const [index, raw] of parsed.entries()) {
    const line = index + 2; // +1 for zero-based, +1 for the header row.
    const email = (raw.email ?? "").trim().toLowerCase();

    let firstName = (raw.firstName ?? "").trim();
    let lastName = (raw.lastName ?? "").trim();
    if (!firstName && raw.fullName) {
      ({ firstName, lastName } = splitName(raw.fullName));
    }

    const base = { line, email: email || null, firstName: firstName || null, lastName: lastName || null };

    if (!email) {
      rows.push({ ...base, outcome: "missing_email" });
      continue;
    }
    if (!EMAIL.test(email)) {
      rows.push({ ...base, outcome: "invalid_email" });
      continue;
    }
    if (!firstName) {
      rows.push({ ...base, outcome: "missing_name" });
      continue;
    }
    if (seen.has(email)) {
      rows.push({ ...base, outcome: "duplicate_in_file" });
      continue;
    }
    seen.add(email);

    if (dryRun) {
      rows.push({ ...base, outcome: "would_import" });
      continue;
    }

    try {
      await candidateService.apply(jobId, {
        firstName,
        lastName,
        email,
        ...(raw.phone?.trim() && { phone: raw.phone.trim() }),
        source: "imported",
        // Never. A spreadsheet cannot consent on someone's behalf.
        messagingOptIn: false,
      });
      rows.push({ ...base, outcome: "imported" });
    } catch (error) {
      if (error instanceof DuplicateApplicationError) {
        // Not a failure. It is what a corrected file re-uploaded looks like.
        rows.push({ ...base, outcome: "already_on_job" });
        continue;
      }
      rows.push({ ...base, outcome: "failed", detail: getErrorMessage(error) });
    }
  }

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;

  return { rows, counts };
}

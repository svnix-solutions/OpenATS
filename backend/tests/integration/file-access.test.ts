import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

import { db, runInOrganization } from "../../src/db";
import { candidates } from "../../src/db/schema/candidates";
import { canReadResumeKey } from "../../src/shared/auth/job-access";
import { parseFileKey } from "../../src/shared/services/r2.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * Who may read a CV out of a private bucket.
 *
 * A key names an object, not a person, so the question "may you read this"
 * cannot be answered from the key — the row has to be found first. Two things
 * have to hold: another tenant's key must not resolve at all, and within a
 * tenant the answer must follow the same visibility rule as the application
 * the CV was submitted with.
 */

let s: Scenario;
let other: Scenario;

const KEY_A1 = "resumes/11111111-1111-4111-8111-111111111111.pdf";
const KEY_B1 = "resumes/22222222-2222-4222-8222-222222222222.pdf";
const KEY_OTHER = "resumes/33333333-3333-4333-8333-333333333333.pdf";

beforeAll(async () => {
  // The foreign world first, deliberately: `itInOrg` runs in whichever
  // scenario was created last, so this order is what puts the tests inside
  // `s` looking out, rather than inside `other` looking at nothing.
  other = await createScenario("files-other");
  s = await createScenario("files");

  // personA1 applied to jobA (the interviewer's job); personB1 to jobB.
  await runInOrganization(s.organizationId, async () => {
    await db
      .update(candidates)
      .set({ resumeUrl: `https://old-public-bucket.test/${KEY_A1}` })
      .where(eq(candidates.id, s.personA1));
    await db
      .update(candidates)
      .set({ resumeUrl: `https://old-public-bucket.test/${KEY_B1}` })
      .where(eq(candidates.id, s.personB1));
  });

  await runInOrganization(other.organizationId, () =>
    db
      .update(candidates)
      .set({ resumeUrl: `https://old-public-bucket.test/${KEY_OTHER}` })
      .where(eq(candidates.id, other.personA1)),
  );
});

afterAll(async () => {
  await destroyScenario(s);
  await destroyScenario(other);
});

describe("which keys are servable at all", () => {
  // Plain `it`: parseFileKey touches no database, so there is no organization
  // for it to run in.
  it("accepts the shape uploadFile writes", () => {
    expect(parseFileKey(KEY_A1)).toBe("resumes");
    expect(parseFileKey("logos/44444444-4444-4444-8444-444444444444.png")).toBe(
      "logos",
    );
  });

  it("refuses anything else", () => {
    // Traversal is not a case to sanitise — it simply is not this shape.
    expect(parseFileKey("logos/../resumes/x.pdf")).toBeNull();
    expect(parseFileKey("resumes/../../etc/passwd")).toBeNull();
    expect(parseFileKey("backups/dump.sql")).toBeNull();
    expect(parseFileKey("resumes/not-a-uuid.pdf")).toBeNull();
    // A folder we do write to, but the key has to name one object in it.
    expect(parseFileKey("resumes/")).toBeNull();
  });
});

describe("who may read a CV", () => {
  itInOrg("lets an admin read one", async () => {
    expect(await canReadResumeKey(s.admin, KEY_A1)).toBe(true);
  });

  itInOrg("lets an interviewer read a CV from their own job", async () => {
    expect(await canReadResumeKey(s.interviewer, KEY_A1)).toBe(true);
  });

  itInOrg("refuses an interviewer a CV from a job they are not on", async () => {
    // The same rule the application itself is behind. Without it, every CV in
    // the organization is readable by anyone holding a key.
    expect(await canReadResumeKey(s.interviewer, KEY_B1)).toBe(false);
  });

  itInOrg("refuses a key belonging to another organization", async () => {
    // Not a rule written here: the lookup runs through the policy, so the row
    // is not there to be found. An admin is the strongest role there is and
    // still gets nothing.
    expect(await canReadResumeKey(s.admin, KEY_OTHER)).toBe(false);
  });

  itInOrg("refuses a key nothing is stored under", async () => {
    expect(
      await canReadResumeKey(s.admin, "resumes/99999999-9999-4999-8999-999999999999.pdf"),
    ).toBe(false);
  });
});

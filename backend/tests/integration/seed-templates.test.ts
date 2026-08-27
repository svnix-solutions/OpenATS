import { describe, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { templates } from "../../src/db/schema";
import {
  DEFAULT_EMAIL_TEMPLATES,
  seedEmailTemplates,
} from "../../src/db/seed";
import {
  itInOrg,
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

/**
 * An organization with no email templates cannot send anything to a
 * candidate: an offer needs `offer_letter_html`, rendered from a template, and
 * the rejection dialog refuses to send without one. Both candidate-facing
 * emails were unreachable on a fresh install, because `templates.created_by`
 * was NOT NULL and no user exists before anyone signs in.
 */

const SUFFIX = `seed-tpl-${Date.now()}`;
let organizationId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
});

afterAll(async () => {
  await dropTestOrganization(organizationId);
});

describe("seeding the default email templates", () => {
  itInOrg("creates them with no author, because nobody wrote them", async () => {
    await seedEmailTemplates();

    const rows = await db
      .select()
      .from(templates)
      .where(eq(templates.type, "email"));

    expect(rows.map((r) => r.name).sort()).toEqual(
      DEFAULT_EMAIL_TEMPLATES.map((t) => t.name).sort(),
    );
    // Attributing a template the installation provided to whoever signed in
    // first would be a lie, and the NOT NULL that forced it is what made a
    // fresh install unable to send at all.
    for (const row of rows) expect(row.createdBy).toBeNull();
  });

  itInOrg("carries the link a candidate can actually open", async () => {
    await seedEmailTemplates();

    const [offerTemplate] = await db
      .select()
      .from(templates)
      .where(eq(templates.name, "Offer Letter"));

    const body = String(offerTemplate!.bodyJson);
    expect(body).toContain("{{offer_review_url}}");
    // /offers is the agency's list and needs a login. A default template that
    // shipped the plural would put every candidate on a login page.
    expect(body).not.toContain("/offers/");
  });

  itInOrg("adds nothing on a second run", async () => {
    await seedEmailTemplates();
    await seedEmailTemplates();

    const rows = await db
      .select()
      .from(templates)
      .where(eq(templates.type, "email"));
    expect(rows).toHaveLength(DEFAULT_EMAIL_TEMPLATES.length);
  });

  itInOrg("leaves an edited template alone", async () => {
    await seedEmailTemplates();
    await db
      .update(templates)
      .set({ subject: "Our own wording" })
      .where(eq(templates.name, "Rejection"));

    await seedEmailTemplates();

    const [rejection] = await db
      .select()
      .from(templates)
      .where(eq(templates.name, "Rejection"));

    // Someone rewrites the letter, runs the seed again for an unrelated
    // reason, and a delete-and-replace would have thrown their version away.
    expect(rejection!.subject).toBe("Our own wording");
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";

// Captures what would have been handed to Resend. The real client is never
// constructed, so no key is needed and nothing leaves the process.
const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { id: "test" }, error: null }),
);

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => send(...args) };
  },
}));

import { db, runInOrganization } from "../../src/db";
import { organizations } from "../../src/db/schema/organizations";
import { mailService } from "../../src/shared/services/mail.service";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `brand-${Date.now()}`;
let organizationId: number;

/** The single argument Resend was called with, for the last send. */
function lastPayload(): { from: string; subject: string; html: string } {
  const call = send.mock.calls.at(-1);
  return call![0] as { from: string; subject: string; html: string };
}

async function renameOrganization(name: string) {
  await runInOrganization(organizationId, () =>
    db
      .update(organizations)
      .set({ name })
      .where(eq(organizations.id, organizationId)),
  );
}

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
});

afterAll(async () => {
  await dropTestOrganization(organizationId);
});

describe("per-agency email branding", () => {
  it("sends under the organization's name and fills in {{brand}}", async () => {
    await runInOrganization(organizationId, () =>
      mailService.sendEmail({
        to: "someone@example.test",
        subject: "Hello from {{brand}}",
        html: "<p>Powered by {{brand}}</p>",
      }),
    );

    const { from, subject, html } = lastPayload();

    expect(from).toContain(`Org ${SUFFIX}`);
    expect(subject).toBe(`Hello from Org ${SUFFIX}`);
    expect(html).toBe(`<p>Powered by Org ${SUFFIX}</p>`);
    // The token is an implementation detail; none of it should reach a reader.
    expect(html).not.toContain("{{brand}}");
  });

  it("falls back to OpenATS outside an organization context", async () => {
    // The worker and any startup path legitimately have no tenant. Sending
    // under an empty name, or failing, would both be worse than a default.
    await mailService.sendEmail({
      to: "someone@example.test",
      subject: "No tenant",
      html: "<p>{{brand}}</p>",
    });

    expect(lastPayload().from).toContain("OpenATS");
    expect(lastPayload().html).toBe("<p>OpenATS</p>");
  });

  it("escapes the organization name in the body", async () => {
    await renameOrganization("Acme <b>Recruiting</b> & Co");

    await runInOrganization(organizationId, () =>
      mailService.sendEmail({
        to: "someone@example.test",
        subject: "escaping",
        html: "<p>{{brand}}</p>",
      }),
    );

    // The name is chosen by whoever created the tenant, and this HTML is sent
    // to candidates outside the organization.
    expect(lastPayload().html).toBe(
      "<p>Acme &lt;b&gt;Recruiting&lt;/b&gt; &amp; Co</p>",
    );
  });

  it("keeps a newline in the name out of the From header", async () => {
    await renameOrganization("Evil\r\nBcc: victim@example.test");

    await runInOrganization(organizationId, () =>
      mailService.sendEmail({
        to: "someone@example.test",
        subject: "headers",
        html: "<p>x</p>",
      }),
    );

    const { from } = lastPayload();
    expect(from).not.toContain("\r");
    expect(from).not.toContain("\n");
    // The display name is what this guards; the address comes from
    // RESEND_FROM_EMAIL, which .env.test does not set. Asserting the whole
    // header pinned it to the fallback address and failed for anyone whose
    // backend/.env happened to define one.
    expect(from).toMatch(/^Evil Bcc: victim@example\.test <[^<>]+>$/);
  });
});

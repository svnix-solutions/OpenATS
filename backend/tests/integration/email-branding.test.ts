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
import { company } from "../../src/db/schema/company";
import { mailService } from "../../src/shared/services/mail.service";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `brand-${Date.now()}`;
let organizationId: number;

/** The single argument Resend was called with, for the last send. */
function lastPayload(): {
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
} {
  const call = send.mock.calls.at(-1);
  return call![0] as {
    from: string;
    subject: string;
    html: string;
    replyTo?: string;
  };
}

/** The agency's own profile — the row Settings → General edits. */
async function setCompanyProfile(name: string, email: string) {
  await runInOrganization(organizationId, async () => {
    await db.delete(company);
    await db.insert(company).values({ name, email });
  });
}

async function clearCompanyProfile() {
  await runInOrganization(organizationId, () => db.delete(company));
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

  it("prefers the agency's own name over the organization's", async () => {
    // `organizations.name` is written by the tenancy migration as "Default"
    // and by provision-org; nothing in the product can change it. `company` is
    // what Settings → General edits. Reading the wrong one meant every email
    // on a migrated install was branded "Default" with no way to fix it.
    await renameOrganization("Default");
    await setCompanyProfile("Northwind Talent", "hello@northwind.test");

    await runInOrganization(organizationId, () =>
      mailService.sendEmail({
        to: "candidate@example.test",
        subject: "Your application to {{brand}}",
        html: "<p>{{brand}}</p>",
      }),
    );

    const { from, subject } = lastPayload();
    expect(from).toContain("Northwind Talent");
    expect(from).not.toContain("Default");
    expect(subject).toBe("Your application to Northwind Talent");
  });

  it("points replies at the agency, not the sending address", async () => {
    await setCompanyProfile("Northwind Talent", "hello@northwind.test");

    await runInOrganization(organizationId, () =>
      mailService.sendEmail({
        to: "candidate@example.test",
        subject: "Your offer",
        html: "<p>x</p>",
      }),
    );

    // Without this a candidate replying to an offer writes to
    // RESEND_FROM_EMAIL — a no-reply address, and by default Resend's sandbox
    // sender, which does not accept mail at all. The reply went nowhere.
    expect(lastPayload().replyTo).toBe("hello@northwind.test");
  });

  it("omits Reply-To when the agency has no profile yet", async () => {
    await clearCompanyProfile();
    await renameOrganization(`Org ${SUFFIX}`);

    await runInOrganization(organizationId, () =>
      mailService.sendEmail({
        to: "candidate@example.test",
        subject: "Still sends",
        html: "<p>{{brand}}</p>",
      }),
    );

    // Sent, not failed: a tenant that has not filled in its profile still
    // needs its offers to go out. And absent rather than empty — some clients
    // read a blank Reply-To as "reply to nobody" instead of falling back.
    const { from, replyTo } = lastPayload();
    expect(replyTo).toBeUndefined();
    expect(from).toContain(`Org ${SUFFIX}`);
  });

  it("escapes the organization name in the body", async () => {
    await clearCompanyProfile();
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
    await clearCompanyProfile();
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

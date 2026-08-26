import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Mail now has two transports: SMTP when `SMTP_HOST` is set — which is how
 * outgoing mail is read during development, in the Mailpit container — and
 * Resend otherwise.
 *
 * The risk in a second path is not that it fails. It is that it quietly
 * formats mail differently from the one production uses, and nobody notices
 * because the development path is the only one anybody looks at. So what is
 * pinned here is that both are handed the same From, Subject and body.
 */

const resendSend = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { id: "resend" }, error: null }),
);
const smtpSend = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ messageId: "<smtp>" }),
);
const createTransport = vi.hoisted(() =>
  vi.fn((_options: unknown) => ({ sendMail: smtpSend })),
);

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => resendSend(...args) };
  },
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: (options: unknown) => createTransport(options) },
}));

import { db, runInOrganization } from "../../src/db";
import { organizations } from "../../src/db/schema/organizations";
import {
  mailService,
  resetMailTransport,
} from "../../src/shared/services/mail.service";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `transport-${Date.now()}`;
const AGENCY = "Northwind Talent";
let organizationId: number;

const MAIL = {
  to: "candidate@example.test",
  subject: "Your application to {{brand}}",
  html: "<p>{{brand}} has read it.</p>",
};

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
  await runInOrganization(organizationId, () =>
    db
      .update(organizations)
      .set({ name: AGENCY })
      .where(eq(organizations.id, organizationId)),
  );
});

afterAll(async () => {
  await dropTestOrganization(organizationId);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetMailTransport();
  resendSend.mockClear();
  smtpSend.mockClear();
  createTransport.mockClear();
});

async function send() {
  await runInOrganization(organizationId, () => mailService.sendEmail(MAIL));
}

describe("choosing a mail transport", () => {
  it("uses SMTP when SMTP_HOST is set, and does not call Resend", async () => {
    vi.stubEnv("SMTP_HOST", "localhost");
    vi.stubEnv("SMTP_PORT", "1025");
    resetMailTransport();

    await send();

    expect(smtpSend).toHaveBeenCalledTimes(1);
    // The point of the catcher is that nothing leaves the machine.
    expect(resendSend).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "localhost", port: 1025 }),
    );
  });

  it("uses Resend when it is not, and does not open an SMTP connection", async () => {
    vi.stubEnv("SMTP_HOST", "");
    resetMailTransport();

    await send();

    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(smtpSend).not.toHaveBeenCalled();
  });

  it("sends the same From, Subject and body either way", async () => {
    vi.stubEnv("SMTP_HOST", "localhost");
    resetMailTransport();
    await send();
    const overSmtp = smtpSend.mock.calls.at(-1)![0] as Record<string, string>;

    vi.stubEnv("SMTP_HOST", "");
    resetMailTransport();
    await send();
    const overResend = resendSend.mock.calls.at(-1)![0] as Record<
      string,
      unknown
    >;

    // Branding, header escaping and template substitution all happen above the
    // transport. If that ever stops being true, this is what says so.
    expect(overSmtp.from).toBe(overResend.from);
    expect(overSmtp.subject).toBe(overResend.subject);
    expect(overSmtp.html).toBe(overResend.html);

    // And the tenant's name reached both, rather than the fallback.
    expect(overSmtp.subject).toBe(`Your application to ${AGENCY}`);
    expect(overSmtp.from).toContain(AGENCY);
  });
});

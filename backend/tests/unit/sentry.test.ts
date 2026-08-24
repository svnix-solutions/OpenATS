import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  delete process.env.SENTRY_DSN;
  vi.resetModules();
});

describe("error tracking", () => {
  it("starts no client without a DSN", async () => {
    vi.resetModules();
    const { initSentry, Sentry } = await import("../../src/config/sentry");

    initSentry();

    // How the test suite and CI run. If a client started here, every failing
    // test would report into a real project.
    expect(Sentry.getClient()).toBeUndefined();
  });

  it("does not throw when reporting with tracking off", async () => {
    vi.resetModules();
    const { captureError } = await import("../../src/config/sentry");

    expect(() => captureError(new Error("boom"))).not.toThrow();
  });

  it("starts a client when a DSN is set", async () => {
    // Valid but unroutable: the client initialises and nothing is flushed.
    process.env.SENTRY_DSN = "https://abc123@localhost/42";
    vi.resetModules();
    const { initSentry, Sentry } = await import("../../src/config/sentry");

    initSentry();

    expect(Sentry.getClient()).toBeDefined();
    expect(Sentry.getClient()!.getOptions().sendDefaultPii).toBe(false);
  });
});

describe("tagOrganization", () => {
  it("tags the organization the error came from", async () => {
    const { tagOrganization } = await import("../../src/config/sentry");
    const { orgContext } = await import("../../src/db/org-context");

    const tagged = orgContext.run({ scoped: null, organizationId: 99 }, () =>
      tagOrganization({} as { tags?: Record<string, unknown> }),
    );

    expect(tagged.tags?.organizationId).toBe("99");
  });

  it("leaves it off an error raised outside a request", async () => {
    const { tagOrganization } = await import("../../src/config/sentry");

    // Startup, the pool, shutdown. Inventing a tenant would be worse.
    expect(tagOrganization({}).tags).toBeUndefined();
  });

  it("keeps tags already on the event", async () => {
    const { tagOrganization } = await import("../../src/config/sentry");
    const { orgContext } = await import("../../src/db/org-context");

    const tagged = orgContext.run({ scoped: null, organizationId: 3 }, () =>
      tagOrganization({ tags: { queue: "cv-analysis" } }),
    );

    expect(tagged.tags).toEqual({ queue: "cv-analysis", organizationId: "3" });
  });
});

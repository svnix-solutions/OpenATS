import { describe, it, expect, vi } from "vitest";

/**
 * The logger reads NODE_ENV at import time, so each case imports it fresh.
 * Returns the lines the Console transport actually wrote.
 */
async function capture(
  env: string | undefined,
  run: (logger: {
    info: (m: string, ...a: unknown[]) => void;
    error: (m: string, ...a: unknown[]) => void;
  }) => void,
  organizationId?: number,
): Promise<string[]> {
  const previous = process.env.NODE_ENV;
  if (env === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = env;

  vi.resetModules();
  const logger = (await import("../../src/utils/logger")).default;
  // Must come from the registry the reset above created, or it is a different
  // AsyncLocalStorage than the logger just imported and nothing is shared.
  const { orgContext } = await import("../../src/db/org-context");

  // A winston logger is a stream, and each `data` event carries the info
  // object with the fully formatted line on Symbol.for("message") — which is
  // exactly what a transport writes out.
  const lines: string[] = [];
  const onData = (info: Record<symbol, unknown>) => {
    lines.push(String(info[Symbol.for("message")]));
  };
  logger.on("data", onData);

  try {
    if (organizationId === undefined) {
      run(logger as never);
    } else {
      orgContext.run({ scoped: null, organizationId }, () =>
        run(logger as never),
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    logger.off("data", onData);
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }

  return lines;
}

describe("logger organization stamping", () => {
  it("stamps the organization a line came from, and omits it outside one", async () => {
    const inside = await capture(
      "production",
      (logger) => logger.info("inside a request"),
      42,
    );
    expect(JSON.parse(inside[0]!).organizationId).toBe(42);

    // Startup, the pool and shutdown all log outside any request. Inventing
    // an organization for those would be worse than leaving the field off.
    const outside = await capture("production", (logger) =>
      logger.info("outside a request"),
    );
    expect(JSON.parse(outside[0]!).organizationId).toBeUndefined();
  });

  it("shows the organization in the readable format too", async () => {
    const lines = await capture("development", (l) => l.info("hello"), 7);
    expect(lines[0]).toContain("[org 7]");
  });
});

describe("logger", () => {
  it("emits one parseable JSON object per line in production", async () => {
    const lines = await capture("production", (l) => l.info("hello"));

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.message).toBe("hello");
    expect(parsed.level).toBe("info");
    expect(parsed.timestamp).toBeTruthy();
  });

  it("keeps an Error's stack as its own field rather than losing it", async () => {
    // The whole point of the item: a user-reported error has to be
    // investigable, and an error logged as "[object Object]" is not.
    const boom = new Error("connection refused");
    const lines = await capture("production", (l) => l.error("db failed:", boom));

    // winston folds the error's text into the message, which keeps the line
    // readable. The structured fields are what makes it investigable, and the
    // stack is the part that used to be lost entirely.
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.message).toContain("db failed:");
    expect(parsed.error.name).toBe("Error");
    expect(parsed.error.message).toBe("connection refused");
    expect(parsed.error.stack).toContain("connection refused");
    expect(parsed.error.stack).toContain("at ");
  });

  it("carries non-Error extras through as details", async () => {
    const lines = await capture("production", (l) =>
      l.info("resolved", { jobId: 7 }),
    );

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.details).toEqual(['{"jobId":7}']);
  });

  it("survives a circular object instead of throwing inside the logger", async () => {
    const circular: Record<string, unknown> = { name: "req" };
    circular.self = circular;

    const lines = await capture("production", (l) => l.info("cycle", circular));

    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });

  it("stays human-readable outside production", async () => {
    const lines = await capture("development", (l) => l.info("hello"));

    expect(lines[0]).toContain("INFO: hello");
    expect(() => JSON.parse(lines[0]!)).toThrow();
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { validateEnv } from "../../src/config/env";

/**
 * Which variables each process is required to have.
 *
 * The Telegram bridge deliberately carries almost nothing — a database, Redis,
 * and the key that decrypts a session. It used to call the same validator as
 * the API and refused to start over a missing Resend key it would never use,
 * which is how the container crash-looped.
 *
 * Narrowing has an obvious failure mode of its own: if it quietly let the API
 * start without its storage credentials, a missing secret would surface as a
 * failed CV upload a week later instead of a message at boot naming it.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

/** validateEnv exits the process; this catches that instead of dying. */
function attempt(keys?: Parameters<typeof validateEnv>[0]) {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((m: unknown) => {
    errors.push(String(m));
  });
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation((() => {
      throw new Error("exited");
    }) as never);

  try {
    validateEnv(keys);
    return { exited: false, errors };
  } catch {
    return { exited: true, errors };
  } finally {
    exit.mockRestore();
  }
}

const BRIDGE = ["DATABASE_URL", "REDIS_URL", "ENCRYPTION_KEY"] as const;

describe("a process that needs three variables", () => {
  it("starts with those three and nothing else", () => {
    process.env = {
      DATABASE_URL: "postgresql://u:p@localhost:5432/d",
      REDIS_URL: "redis://localhost:6379",
      ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    } as NodeJS.ProcessEnv;

    expect(attempt(BRIDGE).exited).toBe(false);
  });

  it("still refuses when one of its own three is missing", () => {
    process.env = {
      DATABASE_URL: "postgresql://u:p@localhost:5432/d",
      REDIS_URL: "redis://localhost:6379",
    } as NodeJS.ProcessEnv;

    const { exited, errors } = attempt(BRIDGE);
    expect(exited).toBe(true);
    expect(errors.join()).toContain("ENCRYPTION_KEY");
  });
});

describe("the full check, which the API still uses", () => {
  it("refuses a missing storage secret rather than finding out later", () => {
    // The failure narrowing must not cause: a missing R2 secret surfacing as a
    // broken upload a week after deploy instead of a message at boot.
    process.env = {
      DATABASE_URL: "postgresql://u:p@localhost:5432/d",
      REDIS_URL: "redis://localhost:6379",
      ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    } as NodeJS.ProcessEnv;

    const { exited, errors } = attempt();
    expect(exited).toBe(true);
    expect(errors.join()).toContain("R2_SECRET_ACCESS_KEY");
  });
});

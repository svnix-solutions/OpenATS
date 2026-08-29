import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * How many proxies the app trusts to have written X-Forwarded-For.
 *
 * The setting exists because IP rate limiting is only as good as the address
 * it keys on. Behind a proxy with no trust configured every request carries
 * the proxy's address, so `/public/*` and `/files/logos` share one bucket
 * across the whole internet. Trusting too much is the opposite failure: a
 * client writes X-Forwarded-For itself, so `trust proxy: true` lets anyone
 * present a fresh address per request and never be limited at all.
 */

const ORIGINAL = process.env.TRUST_PROXY;

async function appWith(value: string | undefined) {
  if (value === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = value;

  // The setting is read at module load.
  const mod = await import(`../../src/app?trust=${value ?? "unset"}`);
  return mod.default as { get(name: string): unknown };
}

beforeEach(() => {
  delete process.env.TRUST_PROXY;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = ORIGINAL;
});

describe("trust proxy", () => {
  it("trusts nothing by default", async () => {
    const app = await appWith(undefined);
    // Express's own default. A process reachable directly must not believe a
    // header the client writes.
    expect(app.get("trust proxy")).toBe(false);
  });

  it("trusts the configured number of hops", async () => {
    const app = await appWith("1");
    expect(app.get("trust proxy")).toBe(1);
  });

  it("ignores a value that is not a positive count", async () => {
    // Notably "true": someone reaching for the Express spelling would
    // otherwise turn off IP rate limiting while believing they had fixed it.
    for (const bad of ["true", "0", "-1", "banana", ""]) {
      const app = await appWith(bad);
      expect(app.get("trust proxy")).toBe(false);
    }
  });
});

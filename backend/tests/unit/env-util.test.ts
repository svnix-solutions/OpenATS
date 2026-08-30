import { describe, it, expect, afterEach } from "vitest";
import { envOr, envNumberOr } from "../../src/utils/env.util";

/**
 * Blank is how an unset variable actually arrives.
 *
 * `.env.example` ships keys with no value and `make setup` copies the file
 * verbatim; `${VAR:-}` in a compose file passes an empty string rather than
 * omitting the variable. `process.env.X ?? fallback` skips the fallback for
 * both, because `??` only catches `undefined`.
 */

const NAME = "OPENATS_TEST_ENV_VALUE";
afterEach(() => delete process.env[NAME]);

describe("envOr", () => {
  it("uses the fallback when unset", () => {
    expect(envOr(NAME, "fallback")).toBe("fallback");
  });

  it("uses the fallback when blank", () => {
    // The regression: R2_REGION= reached the AWS SDK as region: "" and the
    // backend refused to start with "Region is missing".
    for (const blank of ["", " ", "\t", "\n"]) {
      process.env[NAME] = blank;
      expect(envOr(NAME, "fallback")).toBe("fallback");
    }
  });

  it("uses the value when there is one", () => {
    process.env[NAME] = "eu-central-003";
    expect(envOr(NAME, "fallback")).toBe("eu-central-003");
  });

  it("does not trim a value it keeps", () => {
    // Blank decides whether to fall back; it does not rewrite what is kept.
    process.env[NAME] = " padded ";
    expect(envOr(NAME, "fallback")).toBe(" padded ");
  });
});

describe("envNumberOr", () => {
  it("uses the fallback when unset or blank", () => {
    expect(envNumberOr(NAME, 1000)).toBe(1000);
    process.env[NAME] = "";
    expect(envNumberOr(NAME, 1000)).toBe(1000);
  });

  it("uses the fallback for something that is not a number", () => {
    // Number("") is 0, which as a rate limit refuses every request and as a
    // port makes the OS choose one. Wrong in a way that looks configured.
    process.env[NAME] = "banana";
    expect(envNumberOr(NAME, 1000)).toBe(1000);
  });

  it("keeps a real number, including zero", () => {
    process.env[NAME] = "0";
    expect(envNumberOr(NAME, 1000)).toBe(0);
    process.env[NAME] = "250";
    expect(envNumberOr(NAME, 1000)).toBe(250);
  });
});

import { describe, it, expect } from "vitest";
import { toChannelAddress } from "../../src/shared/messaging/address";

/**
 * The application form and the WhatsApp webhook have to agree on what a phone
 * number looks like, and they start from opposite ends: one is typed by a
 * person, the other is `from` on Meta's payload — digits, no plus, no spaces.
 *
 * Disagreeing here does not fail loudly. Every inbound reply is simply dropped
 * as coming from a number nobody recognises.
 */
describe("toChannelAddress", () => {
  it("reduces what people type to what the webhook sends", () => {
    for (const typed of [
      "+491701234567",
      "+49 170 1234567",
      "+49 (170) 123-4567",
      "  +49-170-1234567  ",
      "00491701234567",
      "0049 170 1234567",
    ]) {
      expect(toChannelAddress(typed)).toBe("491701234567");
    }
  });

  it("refuses a number with no country code", () => {
    // 07700 900123 is a different person in every country. Guessing one from
    // the agency's location would message a stranger.
    expect(toChannelAddress("07700900123")).toBeNull();
    expect(toChannelAddress("170 1234567")).toBeNull();
  });

  it("refuses what cannot be a number", () => {
    expect(toChannelAddress(null)).toBeNull();
    expect(toChannelAddress(undefined)).toBeNull();
    expect(toChannelAddress("")).toBeNull();
    expect(toChannelAddress("+12")).toBeNull();
    expect(toChannelAddress("+" + "9".repeat(16))).toBeNull();
    expect(toChannelAddress("not a phone")).toBeNull();
  });
});

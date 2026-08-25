import { describe, it, expect } from "vitest";
import { parseRoomId, parseChatMessage, MAX_CHAT_MESSAGE_LENGTH } from "../../src/shared/auth/job-access";

describe("parseRoomId", () => {
  it("accepts positive integers", () => {
    expect(parseRoomId(1)).toBe(1);
    expect(parseRoomId(4242)).toBe(4242);
  });

  it("accepts numeric strings, since socket payloads are untyped", () => {
    expect(parseRoomId("7")).toBe(7);
  });

  it("rejects values that are not usable row ids", () => {
    for (const bad of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      "",
      "abc",
      "1; DROP TABLE jobs",
      null,
      undefined,
      {},
      [],
      true,
    ]) {
      expect(parseRoomId(bad)).toBeNull();
    }
  });
});

describe("parseChatMessage", () => {
  it("accepts an ordinary message, trimmed", () => {
    expect(parseChatMessage("  hello  ")).toBe("hello");
  });

  it("rejects anything that is not a string", () => {
    // The handlers annotate this as `string`, but that describes what a
    // well-behaved client sends, not what arrives on a socket.
    expect(parseChatMessage(42)).toBeNull();
    expect(parseChatMessage({ toString: () => "x" })).toBeNull();
    expect(parseChatMessage(["a"])).toBeNull();
    expect(parseChatMessage(null)).toBeNull();
    expect(parseChatMessage(undefined)).toBeNull();
    expect(parseChatMessage(true)).toBeNull();
  });

  it("rejects an empty or whitespace-only message", () => {
    expect(parseChatMessage("")).toBeNull();
    expect(parseChatMessage("   \n\t ")).toBeNull();
  });

  it("rejects a message over the limit but keeps one at it", () => {
    // The column is `text`; without this the bound was Socket.IO's 1 MB
    // frame, per message, repeatable.
    expect(parseChatMessage("a".repeat(MAX_CHAT_MESSAGE_LENGTH))).toHaveLength(
      MAX_CHAT_MESSAGE_LENGTH,
    );
    expect(parseChatMessage("a".repeat(MAX_CHAT_MESSAGE_LENGTH + 1))).toBeNull();
  });

  it("measures the length after trimming", () => {
    const padded = `  ${"a".repeat(MAX_CHAT_MESSAGE_LENGTH)}  `;
    expect(parseChatMessage(padded)).toHaveLength(MAX_CHAT_MESSAGE_LENGTH);
  });
});

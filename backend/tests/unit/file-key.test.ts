import { describe, it, expect } from "vitest";
import { r2Service, parseFileKey } from "../../src/shared/services/r2.service";

/**
 * Reading the object key back out of a stored URL.
 *
 * This used to strip R2_PUBLIC_URL off the front, which tied every stored row
 * to whatever the base was on the day it was written. Moving provider, or
 * putting the API in front of a private bucket, then made `deleteByUrl` treat
 * every existing file as somebody else's and return without deleting it —
 * silently, because "not ours" is a legitimate answer.
 */
describe("extractKeyFromUrl", () => {
  const KEY = "resumes/11111111-1111-4111-8111-111111111111.pdf";

  it("reads the key whatever base the URL carries", () => {
    for (const base of [
      "https://pub-abc.r2.dev",
      "https://f004.backblazeb2.com/file/openats-uploads",
      "https://api.example.com/files",
      "http://localhost:9000/openats-uploads",
    ]) {
      expect(r2Service.extractKeyFromUrl(`${base}/${KEY}`)).toBe(KEY);
    }
  });

  it("ignores a query string", () => {
    // A presigned URL that found its way into a column would otherwise yield a
    // key with the whole signature glued to it.
    expect(
      r2Service.extractKeyFromUrl(`https://x.test/${KEY}?X-Amz-Signature=abc`),
    ).toBe(KEY);
  });

  it("returns null for anything that is not one of our keys", () => {
    expect(r2Service.extractKeyFromUrl("")).toBeNull();
    expect(r2Service.extractKeyFromUrl("https://example.com/avatar.png")).toBeNull();
    expect(r2Service.extractKeyFromUrl("https://x.test/backups/dump.sql")).toBeNull();
    // Deliberate: a bare key with no folder is not addressable either.
    expect(r2Service.extractKeyFromUrl("11111111-1111-4111-8111-111111111111.pdf")).toBeNull();
  });

  it("agrees with parseFileKey about what is servable", () => {
    const key = r2Service.extractKeyFromUrl(`https://x.test/${KEY}`);
    expect(key && parseFileKey(key)).toBe("resumes");
  });
});

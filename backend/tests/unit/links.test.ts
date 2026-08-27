import { describe, it, expect, afterEach } from "vitest";
import {
  offerReviewUrl,
  interviewUrl,
  assessmentUrl,
  careersUrl,
} from "../../src/shared/links";

/**
 * The four pages someone outside the agency ever opens.
 *
 * Each is the singular of a dashboard route that also exists — /offer against
 * /offers, /interview against /interviews, /assessment against /assessments.
 * That is not cosmetic: the plural is behind authentication, so a candidate
 * sent there is redirected to a login page they have no account for, and the
 * offer they were told to accept is unreachable.
 *
 * `{{offer_review_url}}` built the plural for as long as it existed, which is
 * the link a recruiter puts in an offer template and therefore the one most
 * candidates would actually have received.
 */

const ORIGINAL = process.env.FRONTEND_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = ORIGINAL;
});

describe("candidate-facing links", () => {
  it("use the public singular route, never the dashboard plural", () => {
    process.env.FRONTEND_URL = "https://hire.example.test";

    expect(offerReviewUrl("tok")).toBe("https://hire.example.test/offer/tok");
    expect(interviewUrl("tok")).toBe("https://hire.example.test/interview/tok");
    expect(assessmentUrl("tok")).toBe(
      "https://hire.example.test/assessment/tok",
    );
    expect(careersUrl("acme")).toBe("https://hire.example.test/careers/acme");
  });

  it("never emit a plural path", () => {
    process.env.FRONTEND_URL = "https://hire.example.test";
    const all = [
      offerReviewUrl("t"),
      interviewUrl("t"),
      assessmentUrl("t"),
      careersUrl("c"),
    ];
    for (const url of all) {
      expect(url).not.toMatch(/\/(offers|interviews|assessments)\//);
    }
  });

  it("tolerate a trailing slash on FRONTEND_URL", () => {
    // Otherwise every link is a double slash, which some clients mangle and
    // some proxies redirect.
    process.env.FRONTEND_URL = "https://hire.example.test/";
    expect(offerReviewUrl("tok")).toBe("https://hire.example.test/offer/tok");
  });

  it("fall back to localhost when nothing is configured", () => {
    delete process.env.FRONTEND_URL;
    expect(offerReviewUrl("tok")).toBe("http://localhost:3000/offer/tok");
  });
});

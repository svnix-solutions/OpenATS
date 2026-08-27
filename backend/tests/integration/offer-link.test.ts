import { describe, expect, beforeAll, afterAll } from "vitest";
import { variableService } from "../../src/modules/template/variable.service";
import {
  itInOrg,
  createScenario,
  destroyScenario,
  type Scenario,
} from "../helpers/scenario";

/**
 * `{{offer_review_url}}` is what a recruiter drops into an offer template, so
 * it is the link most candidates actually receive — more so than the one the
 * offer service builds for its own fallback email.
 *
 * It pointed at `/offers/<token>`, the dashboard's offer list, which is behind
 * authentication. A candidate following it was redirected to a login page they
 * have no account for, and the offer they had been asked to accept was
 * unreachable. Nothing errored; the mail sent and the link simply went
 * somewhere useless.
 */

let s: Scenario;

beforeAll(async () => {
  s = await createScenario("offer-link");
});

afterAll(async () => {
  await destroyScenario(s);
});

describe("the offer link a template renders", () => {
  itInOrg("points at the candidate's page, not the dashboard", async () => {
    const context = await variableService.getContextForOffer(s.candidateA1, {
      reviewToken: "tok-123",
    });

    expect(context.offer_review_url).toContain("/offer/tok-123");
    // The specific mistake: /offers is the agency's list and requires a login.
    expect(context.offer_review_url).not.toContain("/offers/");
  });

  itInOrg("is absent rather than broken when there is no token", async () => {
    const context = await variableService.getContextForOffer(s.candidateA1, {});
    // A half-built URL in a candidate's email is worse than no link: it looks
    // clickable and goes nowhere.
    expect(context.offer_review_url ?? "").not.toMatch(/\/offer\/$/);
  });
});

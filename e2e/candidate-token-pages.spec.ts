import { test, expect } from "@playwright/test";
import {
  seedWorld,
  seedTokenPages,
  destroyWorld,
  type SeededWorld,
  type SeededTokens,
} from "./seed";

/**
 * The three pages a candidate reaches by following a link, with no account
 * and no session: their offer, their assessment, and the times they can pick
 * from for an interview.
 *
 * All were verified by hand and had no test. Between them they are most of
 * what a candidate ever sees of the product.
 */
let world: SeededWorld;
let tokens: SeededTokens;

test.beforeAll(async () => {
  world = await seedWorld("tokens");
  tokens = await seedTokenPages(world);
});

test.afterAll(async () => {
  await destroyWorld(world);
});

test.describe("the offer page", () => {
  test("shows the offer and accepts it", async ({ page }) => {
    await page.goto(`/offer/${tokens.offerToken}`);

    await expect(page.getByText(world.jobTitle)).toBeVisible();
    await expect(page.getByText(world.candidateName)).toBeVisible();
    await expect(page.getByText(/120,000/)).toBeVisible();
    await expect(page.getByText("Jane Manager")).toBeVisible();

    await page.getByRole("button", { name: /accept offer/i }).click();

    await expect(page.getByText(/offer accepted/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("an unknown token is a 404, not an empty offer", async ({ request }) => {
    // "No such offer" and "an offer belonging to someone else" have to look
    // the same, or the token space becomes enumerable.
    const res = await request.get(
      "http://localhost:8080/public/offers/not-a-real-token",
    );
    expect(res.status()).toBe(404);
  });
});

test.describe("the assessment page", () => {
  test("greets the candidate and offers to start", async ({ page }) => {
    await page.goto(`/assessment/${tokens.assessmentToken}`);

    await expect(page.getByText("Technical Screen")).toBeVisible();
    await expect(page.getByText(new RegExp(world.candidateName, "i"))).toBeVisible();

    // The time limit is stored in minutes and was read as seconds, so a
    // 45-minute assessment announced "0 minutes" and expired after 45s. It
    // appears twice — in the summary and in the guidelines — so this asserts
    // both say 45 rather than picking one and hoping.
    const minutes = page.getByText(/45\s*minutes/i);
    await expect(minutes.first()).toBeVisible();
    expect(await minutes.count()).toBeGreaterThan(0);
    for (const text of await minutes.allInnerTexts()) {
      expect(text).toMatch(/45/);
      expect(text).not.toMatch(/\b0 minutes\b/);
    }
    await expect(page.getByRole("button", { name: /start assessment/i })).toBeVisible();
  });
});

test.describe("the interview page", () => {
  test("offers the times the agency proposed", async ({ page }) => {
    await page.goto(`/interview/${tokens.interviewToken}`);

    await expect(page.getByText("Technical Interview")).toBeVisible();
    await expect(page.getByText(world.jobTitle)).toBeVisible();
    // Both proposed slots, rendered in the visitor's locale.
    await expect(page.getByText(/November 10, 2026/)).toBeVisible();
    await expect(page.getByText(/November 11, 2026/)).toBeVisible();
  });
});

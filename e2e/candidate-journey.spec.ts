import { test, expect } from "@playwright/test";
import { seedWorld, destroyWorld, type SeededWorld } from "./seed";

/**
 * The whole candidate-facing path, in a browser: find the role, read it,
 * apply, and be told it worked.
 *
 * This is the one journey with no authentication anywhere in it, which is
 * exactly why it is worth driving end to end — nothing else in the suite
 * proves a candidate can actually apply.
 */
let world: SeededWorld;

test.beforeAll(async () => {
  world = await seedWorld("journey");
});

test.afterAll(async () => {
  await destroyWorld(world);
});

test("a candidate finds a role and applies", async ({ page }) => {
  await page.goto(`/careers/${world.clientSlug}`);

  await expect(page.getByText(world.jobTitle)).toBeVisible();

  await page.getByRole("link", { name: /apply/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`/careers/${world.clientSlug}/\\d+`));
  await expect(page.getByText("We build things that stay built.")).toBeVisible();

  // First name, last name, email, phone — in that order. Filling them by
  // position is what a candidate does; naming them would be better but the
  // inputs carry no name attribute.
  const email = `ada.${Date.now()}@example.test`;
  const fields = page.getByRole("textbox");
  await fields.nth(0).fill("Ada");
  await fields.nth(1).fill("Lovelace");
  await fields.nth(2).fill(email);
  await fields.nth(3).fill("+15550000001");

  await page.getByRole("button", { name: /submit/i }).click();

  await expect(page.getByText(/application submitted successfully/i)).toBeVisible({
    timeout: 15_000,
  });
});

test("the same person cannot apply to one job twice", async ({ page, request }) => {
  const email = `dup.${Date.now()}@example.test`;
  const body = {
    firstName: "Dup",
    lastName: "Licate",
    email,
    phone: "+15550000002",
  };
  const url = `http://localhost:8080/public/jobs/${world.jobId}/apply`;

  expect((await request.post(url, { data: body })).status()).toBe(201);
  // A second submission is refused rather than creating a second application
  // for the same person and job.
  expect((await request.post(url, { data: body })).status()).toBe(409);
});

test("an unknown company's careers page is a 404, not an empty page", async ({
  page,
}) => {
  // "No such company" and "a company with nothing published" must look the
  // same from outside; neither confirms which slugs exist.
  const res = await page.goto("/careers/definitely-not-a-real-company");
  expect(res?.status()).toBe(404);
});

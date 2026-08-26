import { test, expect } from "@playwright/test";
import { seedWorld, destroyWorld, type SeededWorld } from "./seed";

const API = process.env.OPENATS_API_URL ?? "http://localhost:8080";

/**
 * These used to assert an empty database — "tells visitors when there are no
 * openings" passed because nothing had seeded anything, not because the page
 * was checked against a known state. Any spec that seeded a job broke them.
 */
let world: SeededWorld;

test.beforeAll(async () => {
  world = await seedWorld("careers");
});

test.afterAll(async () => {
  await destroyWorld(world);
});

test.describe("careers page", () => {
  test("lists the client company's published roles", async ({ page }) => {
    await page.goto(`/careers/${world.clientSlug}`);

    await expect(page.getByRole("heading", { name: /open roles/i })).toBeVisible();
    await expect(page.getByText(world.jobTitle)).toBeVisible();
  });

  test("serves that job over the public API", async ({ request }) => {
    const res = await request.get(
      `${API}/public/clients/${world.clientSlug}/jobs`,
    );

    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const titles = (body.data?.jobs ?? body.data ?? []).map(
      (j: { title: string }) => j.title,
    );
    expect(titles).toContain(world.jobTitle);
  });

  // Deliberately not asserting what the bare /careers URL does. It forwards
  // only when exactly one client company exists on the whole install, and any
  // spec that seeds its own makes that untrue — including the one running
  // beside this in another worker. Asserting it would be the same mistake as
  // the "no open positions" test it replaced: a claim about global state that
  // happens to hold until something else seeds data.
});

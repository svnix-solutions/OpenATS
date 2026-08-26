import { test, expect } from "@playwright/test";
import {
  seedWorld,
  destroyWorld,
  seedApplicant,
  type SeededWorld,
} from "./seed";
import {
  seedOperator,
  destroyOperator,
  signIn,
  providerSubjectOf,
  type Operator,
} from "./auth";

/**
 * The agency's own view. Everything else in this directory is a page a
 * candidate reaches without logging in; this is the half staff actually use,
 * and until the identity provider moved in-process it had no browser coverage
 * at all.
 */

let world: SeededWorld;
let neighbour: SeededWorld;
let operator: Operator;
let neighbourOperator: Operator;
let applicant: { name: string };

test.beforeAll(async () => {
  world = await seedWorld("dash");
  // A second agency on the same install, so "cannot see" is a claim about the
  // boundary rather than about an empty database.
  neighbour = await seedWorld("dash-other");
  operator = await seedOperator(world);
  neighbourOperator = await seedOperator(neighbour);
  applicant = await seedApplicant(world);
});

test.afterAll(async () => {
  await destroyOperator(operator);
  await destroyOperator(neighbourOperator);
  await destroyWorld(world);
  await destroyWorld(neighbour);
});

test.describe.configure({ mode: "serial" });

test.describe("the agency dashboard", () => {
  test("signs in and shows the organization's jobs", async ({ page }) => {
    await signIn(page, operator);
    await page.goto("/jobs");
    await expect(page.getByText(world.jobTitle).first()).toBeVisible();
  });

  test("the candidate who applied appears in the pipeline", async ({ page }) => {
    await signIn(page, operator);
    await page.goto("/candidates");
    await expect(page.getByText(applicant.name).first()).toBeVisible();
  });

  test("another agency's job is not reachable, by list or by id", async ({
    page,
  }) => {
    await signIn(page, operator);

    // The tenancy boundary through the product, rather than through a query.
    // Row-level security is what should make this impossible, but nothing had
    // ever checked it from the outside — where a leak would actually be seen.
    //
    // Every absence here waits on a matching presence first. toHaveCount(0)
    // is true of a page that has not finished rendering, so on its own it
    // asserts nothing about what the page would eventually have shown.
    await page.goto("/jobs");
    await expect(page.getByText(world.jobTitle).first()).toBeVisible();
    await expect(page.getByText(neighbour.jobTitle)).toHaveCount(0);

    await page.goto(`/jobs/${world.jobId}`);
    await expect(page.getByText(world.jobTitle).first()).toBeVisible();

    await page.goto(`/jobs/${neighbour.jobId}`);
    await expect(page.getByText(neighbour.jobTitle)).toHaveCount(0);
  });

  test("first sign-in replaces the placeholder identity", async ({ page }) => {
    await signIn(page, operator);

    // seedOperator wrote the membership against a `pending:` subject, because
    // the account had never signed in. The reconcile-by-email branch in
    // app_provision_user is what hands it over, and this is the only place
    // that path runs end to end.
    const subject = await providerSubjectOf(operator.email);
    expect(subject).not.toMatch(/^pending:/);
    expect(subject).toBe(operator.providerId);
  });

  test("two agencies signing in against the same server see only their own", async ({
    browser,
  }) => {
    // The boundary that row-level security cannot defend. It scopes rows, not
    // the Node process, so anything the frontend memoises between requests is
    // shared by every tenant unless its key says otherwise — which is how a
    // departments cache and a socket room both leaked before. Two operators,
    // two organizations, one server, in sequence.
    for (const [who, theirs, notTheirs] of [
      [operator, world, neighbour],
      [neighbourOperator, neighbour, world],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, who);
      await page.goto("/jobs");
      await expect(page.getByText(theirs.jobTitle).first()).toBeVisible();
      await expect(page.getByText(notTheirs.jobTitle)).toHaveCount(0);
      await context.close();
    }
  });

  test("a signed-out visitor is sent to the login page", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/login/);
  });
});

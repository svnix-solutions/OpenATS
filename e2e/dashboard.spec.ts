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

  test("the job page links to the public posting, not a dead URL", async ({
    page,
  }) => {
    await signIn(page, operator);
    await page.goto(`/jobs/${world.jobId}`);

    const link = page.locator('a[href^="/careers/"]').first();
    await expect(link).toHaveAttribute(
      "href",
      `/careers/${world.clientSlug}/${world.jobId}`,
    );

    // The shape matters less than this: the link pointed at /careers/<job id>
    // for as long as careers pages have been per-client, so every job page
    // rendered a link straight to a 404. Following it is what catches that.
    const response = await page.request.get(
      `/careers/${world.clientSlug}/${world.jobId}`,
    );
    expect(response.status()).toBe(200);
  });

  test("opens a candidate in the side panel without leaving the list", async ({
    page,
  }) => {
    await signIn(page, operator);
    await page.goto("/candidates");
    await expect(page.getByText(applicant.name).first()).toBeVisible();

    await page.locator("tbody tr").first().click();

    const panel = page.locator('[data-slot="sheet-content"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(applicant.name).first()).toBeVisible();
    // Still on the list: a panel, not a navigation.
    await expect(page).toHaveURL(/\/candidates$/);
  });

  test("the panel's email form actually sends", async ({ page }) => {
    await signIn(page, operator);
    await page.goto("/candidates");
    // Wait for the row before clicking: an empty tbody makes the click a
    // no-op and the panel never opens.
    await expect(page.getByText(applicant.name).first()).toBeVisible();
    await page.locator("tbody tr").first().click();

    const panel = page.locator('[data-slot="sheet-content"]');
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Send Email" }).click();

    const subject = `Panel send ${Date.now()}`;
    await page
      .getByPlaceholder("e.g. Interview Invitation - Software Engineer")
      .fill(subject);
    await page.getByPlaceholder("Write your message here...").fill("Hello.");
    await page.getByRole("button", { name: /^Send Email$/ }).last().click();

    // The history comes from the server, so its appearing is what proves a
    // request happened. This button had no onClick at all while the panel was
    // a separate copy of the page — it did nothing whatsoever.
    await expect(panel.getByText(subject).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("every link on the dashboard goes somewhere", async ({ page }) => {
    // Longer than the default thirty seconds, because the work is genuinely
    // that long: this visits every dashboard page and then every link they
    // render, and `next dev` compiles each route the first time it is asked
    // for. It ran in about twenty seconds locally, which left it one slow
    // compile from failing — and it did fail, on main, before this budget
    // existed.
    test.setTimeout(120_000);

    await signIn(page, operator);

    // Crawled rather than listed: the three dead links found so far were all
    // in places nobody thought to check — a job's careers link, the offer link
    // inside every template, and this settings back button. Enumerating the
    // hrefs the pages actually render is what finds the next one.
    const pages = [
      "/",
      "/jobs",
      "/candidates",
      "/interviews",
      "/assessments",
      "/offers",
      "/templates",
      "/settings/general",
      "/settings/client-companies",
      "/settings/user-management",
      "/settings/careers-page",
      "/settings/careers-page/preview",
      "/settings/integrations",
      "/settings/profile",
    ];

    const links = new Set<string>();
    for (const path of pages) {
      await page.goto(path);
      // These pages render their content client-side, so reading the DOM
      // straight after goto() sees only the sidebar — which is how the first
      // version of this passed while a dead link sat on one of them.
      await page.waitForLoadState("networkidle");
      for (const href of await page
        .locator("a[href^='/']")
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute("href")).filter((h): h is string => !!h),
        )) {
        links.add(href);
      }
    }

    // Proof the crawl saw rendered pages rather than empty ones — an empty
    // set would make the assertion below vacuously true. Named links rather
    // than a count, because the count depends on how much the fixture seeds.
    for (const expected of [
      "/jobs",
      "/candidates",
      "/settings/profile",
      // A page-level link, not just the sidebar: without one of these the
      // crawl is only checking navigation it was given.
      "/settings/careers-page",
    ]) {
      expect([...links]).toContain(expected);
    }

    // Requested rather than navigated to. The assertion is about the status
    // code, and it was already only reading that — but a `goto` also renders
    // the page and runs its client bundle, which is most of the time spent
    // and none of what is being checked. The context's cookies come along, so
    // these are still authenticated requests.
    const broken: string[] = [];
    for (const href of links) {
      const response = await page.request.get(href);
      if (response.status() >= 400) {
        broken.push(`${href} → ${response.status()}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("creates a job through the form", async ({ page }) => {
    await signIn(page, operator);
    await page.goto("/jobs/new");
    await page.waitForLoadState("networkidle");

    // Every job belongs to a client company and the column is NOT NULL, so a
    // form without this field cannot create one. The route rendered an older
    // copy that had no such field for as long as client companies have
    // existed: every submission failed with a 500 and showed nothing at all.
    await expect(page.getByText("Client Company")).toBeVisible();

    const title = `E2E job ${Date.now()}`;
    await page
      .getByPlaceholder("Senior Software Engineer - Backend")
      .fill(title);

    const selects = page.locator('[role="combobox"]');
    for (const [index, option] of [
      [0, null], // client company
      [1, null], // department
      [2, "Full Time"], // employment type
    ] as const) {
      await selects.nth(index).click();
      // The listbox opens in a portal with an inert overlay that swallows
      // clicks until its animation settles, so wait for the option to be
      // ready rather than racing it.
      const choice = option
        ? page.getByRole("option", { name: option })
        : page.getByRole("option").first();
      await expect(choice).toBeVisible();
      await choice.click();
      await expect(choice).toBeHidden();
    }

    await page.getByRole("button", { name: /Save Job/ }).click();

    // Landing on the new job is the proof it was created: the old form stayed
    // put, which is exactly what made the failure invisible.
    await expect(page).toHaveURL(/\/jobs\/\d+$/, { timeout: 20_000 });
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test("a signed-out visitor is sent to the login page", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/login/);
  });
});

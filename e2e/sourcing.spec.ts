import { test, expect } from "@playwright/test";
import { seedWorld, destroyWorld, type SeededWorld } from "./seed";
import { seedOperator, destroyOperator, signIn, type Operator } from "./auth";

/**
 * Sourcing: adding people who did not apply.
 *
 * None of this had browser coverage, and the two bugs it shipped with were
 * both things only a browser sees. A dialog posted to `/api/candidates/…`
 * from the browser and got a 404 from Next, because the dashboard's calls are
 * server actions and that path does not exist client-side. A route ordering
 * mistake made every import answer 404. Both type-checked; both passed every
 * integration test; both were obvious the moment anything drove the screen.
 */

let world: SeededWorld;
let operator: Operator;

test.beforeAll(async () => {
  world = await seedWorld("sourcing");
  operator = await seedOperator(world);
});

test.afterAll(async () => {
  await destroyOperator(operator);
  await destroyWorld(world);
});

test.describe.configure({ mode: "serial" });

test.describe("adding a candidate by hand", () => {
  test("puts them on the job and shows them in the list", async ({ page }) => {
    await signIn(page, operator);
    await page.goto("/candidates");
    await page.waitForLoadState("networkidle");

    const email = `sourced.${Date.now()}@example.test`;

    await page.getByRole("button", { name: /Add candidate/i }).first().click();
    await page.selectOption("#add-job", { label: world.jobTitle });
    await page.getByLabel("First name").fill("Hand");
    await page.getByLabel("Last name").fill("Added");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /Add to pipeline/i }).click();

    // The dialog closing is the claim that the request succeeded; the row
    // appearing is the claim that it did what it said.
    await expect(
      page.getByRole("button", { name: /Add to pipeline/i }),
    ).toHaveCount(0, { timeout: 15_000 });

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Hand Added").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("refuses the same person on the same job, in a recruiter's words", async ({
    page,
  }) => {
    await signIn(page, operator);
    await page.goto("/candidates");
    await page.waitForLoadState("networkidle");

    const email = `twice.${Date.now()}@example.test`;

    for (const attempt of [1, 2]) {
      await page.getByRole("button", { name: /Add candidate/i }).first().click();
      await page.selectOption("#add-job", { label: world.jobTitle });
      await page.getByLabel("First name").fill("Twice");
      await page.getByLabel("Last name").fill("Over");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: /Add to pipeline/i }).click();
      await page.waitForTimeout(attempt === 1 ? 3000 : 4000);
    }

    // "You have already applied" would be the candidate's own words, shown to
    // a recruiter adding somebody else.
    await expect(
      page.getByText(/already on this job/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("importing a list", () => {
  test("previews the file before anything is written", async ({ page }) => {
    await signIn(page, operator);
    await page.goto("/candidates");
    await page.waitForLoadState("networkidle");

    const stamp = Date.now();
    // A file as one actually arrives: a BOM, CRLF, a quoted comma inside a
    // name, and a header spelled differently from ours.
    const csv =
      "﻿full name,e-mail\r\n" +
      `"Turing, Alan",alan.${stamp}@example.test\r\n` +
      `Cher,cher.${stamp}@example.test\r\n` +
      "Broken Row,not-an-email\r\n";

    await page.getByRole("button", { name: /Add candidate/i }).first().click();
    await page.getByRole("button", { name: /Import a list/i }).click();
    await page.selectOption("#add-job", { label: world.jobTitle });

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "list.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });

    await page.getByRole("button", { name: /Check the file/i }).click();

    await expect(page.getByText(/2 will be added/)).toBeVisible({
      timeout: 15_000,
    });
    // By spreadsheet line, so the row can be found and fixed.
    await expect(
      page.getByText(/Line 4: that is not an email address/),
    ).toBeVisible();

    // A dry run writes nothing. The import button exists but has not been
    // pressed, and the people are not in the list.
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Alan Turing")).toHaveCount(0);
  });

  test("will not import before the file has been checked", async ({ page }) => {
    await signIn(page, operator);
    await page.goto("/candidates");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Add candidate/i }).first().click();
    await page.getByRole("button", { name: /Import a list/i }).click();
    await page.selectOption("#add-job", { label: world.jobTitle });
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "list.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Name,Email\nA B,ab@example.test\n", "utf8"),
    });

    // Importing several hundred people is not something to do without having
    // seen what it will do.
    await expect(
      page.getByRole("button", { name: /^Import \d+$/ }),
    ).toBeDisabled();
  });
});

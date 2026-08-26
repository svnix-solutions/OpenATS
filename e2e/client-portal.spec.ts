import { test, expect } from "@playwright/test";
import {
  seedWorld,
  destroyWorld,
  seedSecondClient,
  type SeededWorld,
} from "./seed";
import {
  seedOperator,
  destroyOperator,
  deleteProviderUserByEmail,
  signIn,
  type Operator,
} from "./auth";

/**
 * Making someone a client contact, and what they see afterwards.
 *
 * The client portal — roles, company scoping, the route gate, the trimmed
 * sidebar — was built and had no browser coverage at all. It also had no way
 * in: the role dropdown offered three of the five roles, so `client_admin`
 * could not be chosen and the client-company selector beside it never
 * rendered. Both halves are covered here, because a door nobody can open and
 * a room nobody has looked in fail the same way — silently.
 */

let world: SeededWorld;
let rival: { clientSlug: string; jobTitle: string; jobId: number };
let operator: Operator;

const CONTACT_EMAIL = `contact.${Date.now()}@example.test`;
const CONTACT_PASSWORD = "Contact@12345";

test.beforeAll(async () => {
  world = await seedWorld("portal");
  // A second client in the same agency. Without one, "sees their own jobs"
  // is indistinguishable from "sees every job".
  rival = await seedSecondClient(world);
  operator = await seedOperator(world);
});

test.afterAll(async () => {
  await deleteProviderUserByEmail(CONTACT_EMAIL);
  await destroyOperator(operator);
  await destroyWorld(world);
});

test.describe.configure({ mode: "serial" });

test.describe("client contacts", () => {
  test("can be created, with a company, from user management", async ({
    page,
  }) => {
    await signIn(page, operator);
    await page.goto("/settings/user-management");

    await page
      .getByRole("button", { name: /add user|create|new user|invite/i })
      .first()
      .click();

    await page.getByPlaceholder("Enter the email address").fill(CONTACT_EMAIL);
    await page.getByPlaceholder("Enter the first name").fill("Portal");
    await page.getByPlaceholder("Enter the last name").fill("Contact");

    const roleSelect = page.locator('[role="combobox"]').first();
    await roleSelect.click();

    // The roles the product offers must be the roles the product has. Three of
    // five were listed, which is what made the portal unreachable.
    //
    // Waited for, not read once: allInnerTexts() resolves immediately, so on a
    // slower machine it returned [] before the listbox had rendered and the
    // assertion failed for want of a frame rather than a role.
    await expect(page.getByRole("option", { name: "Client Admin" })).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Client Reviewer" }),
    ).toBeVisible();

    await page.getByRole("option", { name: "Client Admin" }).click();

    // Choosing a client role reveals the company selector — a client role
    // without a company is refused by the backend and again at sign-in, so
    // the form has to ask.
    const companySelect = page.locator('[role="combobox"]').nth(1);
    await expect(companySelect).toBeVisible();
    await companySelect.click();
    await page.getByRole("option", { name: world.clientName }).click();

    // Setting a password is the default because inviting cannot work without
    // a mail service on the provider. It used to default to inviting, so
    // every creation failed until someone noticed the radio.
    const password = page.getByPlaceholder("Enter the password");
    await expect(password).toBeVisible();
    await password.fill(CONTACT_PASSWORD);

    await page.getByRole("button", { name: "Finish" }).click();

    const row = page.locator("tbody tr", { hasText: CONTACT_EMAIL });
    // Case-insensitive: the cell holds "client admin" and is capitalized by
    // CSS, which the DOM does not know about.
    await expect(row).toContainText(/client admin/i);
    // The company, not just the role: which client a contact belongs to was
    // invisible from the list.
    await expect(row).toContainText(world.clientName);
  });

  test("sign in and see only their own company's jobs", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await signIn(page, {
      email: CONTACT_EMAIL,
      password: CONTACT_PASSWORD,
      providerId: "",
    });

    // The client portal's landing page, not the agency dashboard.
    await expect(page).toHaveURL(/\/jobs/);

    await expect(page.getByText(world.jobTitle).first()).toBeVisible();
    // The absence only means something after the presence above: an unrendered
    // page satisfies toHaveCount(0) on its own.
    await expect(page.getByText(rival.jobTitle)).toHaveCount(0);

    await context.close();
  });

  test("cannot reach the agency's own screens", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, {
      email: CONTACT_EMAIL,
      password: CONTACT_PASSWORD,
      providerId: "",
    });

    // Hiding a link is not a control; the URL is still typeable. Assert where
    // the gate lands them, not that they are "not there" — a negative URL
    // assertion is satisfied by the moment before the redirect, so it passed
    // whether the gate worked or not.
    for (const agencyOnly of [
      "/settings/user-management",
      "/settings/client-companies",
      "/offers",
      "/templates",
    ]) {
      await page.goto(agencyOnly);
      await expect(page).toHaveURL(/\/jobs/);
    }

    await context.close();
  });
});

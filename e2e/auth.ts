import type { Page } from "@playwright/test";
import { Client } from "pg";
import type { SeededWorld } from "./seed";

/**
 * Signing an agency user in, for the specs that need the dashboard.
 *
 * `docs-draft/TESTING.md` said authenticated E2E was not worth setting up
 * because it meant driving a hosted identity provider with real credentials.
 * That stopped being true when the provider moved into a container we start
 * ourselves: creating a user is one admin call, and the sign-in it exercises
 * is the real one, through the real form.
 */

const AUTHORIZER_URL =
  process.env.NEXT_PUBLIC_AUTHORIZER_URL ?? "http://localhost:8090";
const ADMIN_SECRET = process.env.AUTHORIZER_ADMIN_SECRET ?? "";
const OWNER_URL =
  process.env.MIGRATION_DATABASE_URL ??
  "postgresql://openats:openats@localhost:5433/openats_test";

export type Operator = {
  email: string;
  password: string;
  providerId: string;
};

/**
 * Authorizer refuses a state-changing request carrying neither Origin nor
 * Referer, and a server-to-server fetch sends neither — the same rule that
 * stops its own SDK logging in from Node.
 */
async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  admin = false,
): Promise<T> {
  const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      ...(admin ? { "x-authorizer-admin-secret": ADMIN_SECRET } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new Error(`authorizer: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  return body.data as T;
}

/**
 * An agency administrator who can sign in and reach `world`.
 *
 * Two systems have to agree for that: the provider has to know the
 * credentials, and OpenATS has to have a membership placing them in this
 * organization. The membership is written against a `pending:` subject, the
 * same way `provision-org` does it — the first real sign-in reconciles it by
 * email, so this also exercises that handover through the browser.
 */
export async function seedOperator(world: SeededWorld): Promise<Operator> {
  const email = `operator.${world.clientSlug}@example.test`;
  const password = "Operator@12345";

  const created = await graphql<{ signup: { user: { id: string } } }>(
    `mutation ($e: String!, $p: String!) {
       signup(params: {
         email: $e, password: $p, confirm_password: $p, roles: ["super_admin"]
       }) { user { id } }
     }`,
    { e: email, p: password },
    true,
  );

  const client = new Client({ connectionString: OWNER_URL });
  await client.connect();
  try {
    const user = await client.query<{ id: number }>(
      `INSERT INTO users (provider_user_id, email, first_name, last_name)
       VALUES ($1, $2, 'E2E', 'Operator') RETURNING id`,
      [`pending:${world.clientSlug}:${email}`, email],
    );
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'super_admin')`,
      [world.organizationId, user.rows[0]!.id],
    );
  } finally {
    await client.end();
  }

  return { email, password, providerId: created.signup.user.id };
}

/**
 * The organization is deleted by `destroyWorld`, which takes the membership
 * and the user row with it. The provider's copy is outside that cascade and
 * has to be removed on its own, or every run leaves an account behind.
 */
export async function destroyOperator(operator: Operator): Promise<void> {
  await graphql(
    `mutation ($id: String!) { _delete_user(params: { id: $id }) { message } }`,
    { id: operator.providerId },
    true,
  );
}

/** Signs in through the real form and waits for the dashboard to take over. */
export async function signIn(page: Page, operator: Operator): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(operator.email);
  await page.locator("#password").fill(operator.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The form hard-navigates once the session cookie is set, so waiting on the
  // URL leaving /login is what tells us the cookie was actually accepted —
  // a failed sign-in stays put and shows an alert.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
}

/**
 * The provider subject OpenATS has on file for an email — how the placeholder
 * handover is checked after a real sign-in.
 */
export async function providerSubjectOf(email: string): Promise<string> {
  const client = new Client({ connectionString: OWNER_URL });
  await client.connect();
  try {
    const row = await client.query<{ provider_user_id: string }>(
      "SELECT provider_user_id FROM users WHERE email = $1",
      [email],
    );
    return row.rows[0]!.provider_user_id;
  } finally {
    await client.end();
  }
}

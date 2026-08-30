import "server-only";

import { authorizerConfig, serverAuthorizerUrl } from "./config";

/**
 * The user directory in the identity provider.
 *
 * The counterpart to `session.ts`: that one answers "who is this", this one
 * creates and changes them. Both exist so the rest of the app never names a
 * provider — the previous integration spread SCIM calls and role-assignment
 * endpoints across four files, and swapping it meant finding them all.
 *
 * Roles live here *and* in `organization_members`. The provider's copy seeds a
 * membership the first time someone signs in and is ignored afterwards, so
 * changing a role means changing both: this for anyone who has not signed in
 * yet, and the membership for everyone who has.
 */

const ADMIN_SECRET = process.env.AUTHORIZER_ADMIN_SECRET ?? "";

export type DirectoryUser = {
  id: string;
  email: string;
  givenName: string | null;
  familyName: string | null;
  roles: string[];
};

type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

/**
 * One admin GraphQL call.
 *
 * `Origin` is set explicitly: authorizer refuses state-changing requests that
 * carry neither it nor `Referer`, and a server-to-server fetch sends neither.
 * That is also why its own SDK cannot perform a login from Node.
 */
async function admin<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!ADMIN_SECRET) {
    throw new Error(
      "AUTHORIZER_ADMIN_SECRET is not set; user management is unavailable",
    );
  }

  // The internal address: this runs on the server, and the public hostname
  // from in here goes out through whatever terminates TLS and back. The Origin
  // header below stays the public one, because that is what the provider's
  // allowed-origins list contains.
  const res = await fetch(`${serverAuthorizerUrl()}/graphql`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Origin: authorizerConfig.redirectURL,
      "x-authorizer-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await res.json().catch(() => null)) as
    | (GraphQLResponse<T> & { error?: string; error_description?: string })
    | null;

  // Not every refusal is a GraphQL error. A rejected Origin comes back as
  // `403 {"error":"csrf_validation_failed","error_description":"Origin not
  // allowed"}` — no `errors` array and no `data` — which used to fall through
  // to "Identity provider returned no data". That is true and useless: the
  // cause is a hostname missing from AUTHORIZER_ALLOWED_ORIGINS, and nothing
  // in the message pointed at it.
  if (!res.ok || body?.error) {
    const detail =
      body?.error_description ?? body?.error ?? `HTTP ${res.status}`;
    throw new Error(`Identity provider refused the request: ${detail}`);
  }

  if (body?.errors?.length) {
    throw new Error(
      body.errors[0]?.message ?? "Identity provider rejected the request",
    );
  }
  if (!body?.data) throw new Error("Identity provider returned no data");

  return body.data;
}

type RawUser = {
  id: string;
  email: string | null;
  given_name: string | null;
  family_name: string | null;
  roles: string[] | null;
};

const toUser = (u: RawUser): DirectoryUser => ({
  id: u.id,
  email: u.email ?? "",
  givenName: u.given_name,
  familyName: u.family_name,
  roles: u.roles ?? [],
});

export async function listUsers(limit = 200): Promise<DirectoryUser[]> {
  const data = await admin<{ _users: { users: RawUser[] } }>(
    `query($p: ListUsersRequest!) { _users(params: $p) { users { id email given_name family_name roles } } }`,
    { p: { pagination: { limit, page: 1 } } },
  );
  return (data._users.users ?? []).map(toUser);
}

export type CreateUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  password?: string | undefined;
};

/**
 * Creates a user with a password.
 *
 * `signup` rather than an admin mutation, because authorizer has no
 * admin-side create. Inviting by email exists (`_invite_members`) but needs a
 * mail service configured, which a local install does not have.
 */
export async function createUser(input: CreateUserInput): Promise<DirectoryUser> {
  const password = input.password;
  if (!password) {
    throw new Error("A password is required to create a user");
  }

  const data = await admin<{ signup: { user: RawUser | null } }>(
    `mutation($p: SignUpRequest!) { signup(params: $p) { user { id email given_name family_name roles } } }`,
    {
      p: {
        email: input.email,
        password,
        confirm_password: password,
        given_name: input.firstName,
        family_name: input.lastName,
        roles: [input.role],
      },
    },
  );

  const created = data.signup.user;
  if (!created) {
    // signup returns a null user when the account needs verifying before it
    // can be used. It exists; it just cannot sign in yet.
    const existing = (await listUsers()).find((u) => u.email === input.email);
    if (existing) return existing;
    throw new Error("The provider created no user");
  }

  return toUser(created);
}

export async function updateUser(
  id: string,
  changes: {
    email?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    role?: string | undefined;
  },
): Promise<void> {
  await admin(
    `mutation($p: UpdateUserRequest!) { _update_user(params: $p) { id } }`,
    {
      p: {
        id,
        ...(changes.email !== undefined && { email: changes.email }),
        ...(changes.firstName !== undefined && { given_name: changes.firstName }),
        ...(changes.lastName !== undefined && { family_name: changes.lastName }),
        // Replaces rather than appends: a user has one role here, and the
        // previous integration had to remove the old one before adding the new.
        ...(changes.role !== undefined && { roles: [changes.role] }),
      },
    },
  );
}

export async function deleteUser(id: string): Promise<void> {
  await admin(`mutation($p: DeleteUserRequest!) { _delete_user(params: $p) { message } }`, {
    p: { id },
  });
}

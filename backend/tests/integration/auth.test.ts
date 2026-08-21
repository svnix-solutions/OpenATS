import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { inArray } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";

const jwks = vi.hoisted(() => ({ publicKey: null as unknown }));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => async () => jwks.publicKey,
  };
});

import { generateKeyPair, SignJWT } from "jose";
import { db, runInOrganization, unscopedDb } from "../../src/db";
import { sql } from "drizzle-orm";
import { users } from "../../src/db/schema/users";
import { organizationMembers } from "../../src/db/schema/organizations";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";
import {
  AuthError,
  verifyAccessToken,
} from "../../src/shared/auth/verify-token";
import { authMiddleware } from "../../src/middlewares/auth.middleware";

const SUFFIX = `auth-${Date.now()}`;
const ISSUER = process.env.ASGARDEO_ISSUER!;

let privateKey: unknown;
let otherKey: unknown;
const createdEmails: string[] = [];
let organizationId: number;

/**
 * Puts an identity in an organization before the token is presented.
 *
 * Provisioning and membership are separate now: verifyAccessToken creates the
 * user, but which organization they belong to is a question only their
 * sub-organization can answer (phase 3). Everything below that expects a
 * successful login therefore places the user first.
 */
async function seedMember(tag: string) {
  createdEmails.push(email(tag));
  await runInOrganization(organizationId, async () => {
    const [row] = await db
      .insert(users)
      .values({
        asgardeoUserId: `${SUFFIX}-${tag}`,
        firstName: "Test",
        lastName: "User",
        email: email(tag),
      })
      .returning({ id: users.id });
    await db
      .insert(organizationMembers)
      .values({ organizationId, userId: row!.id, role: "recruiter" });
  });
}

function email(tag: string) {
  return `${tag}.${SUFFIX}@example.test`;
}

type Claims = Record<string, unknown>;

async function sign(
  claims: Claims,
  opts: { issuer?: string; expiresIn?: string; key?: unknown } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? ISSUER)
    .setExpirationTime(opts.expiresIn ?? "5m")
    .sign((opts.key ?? privateKey) as Parameters<SignJWT["sign"]>[0]);
}

function validClaims(tag: string, overrides: Claims = {}): Claims {
  return {
    sub: `${SUFFIX}-${tag}`,
    email: email(tag),
    given_name: "Test",
    family_name: "User",
    roles: ["hiring_manager"],
    ...overrides,
  };
}

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwks.publicKey = pair.publicKey;

  const other = await generateKeyPair("RS256");
  otherKey = other.privateKey;
});

afterAll(async () => {
  await unscopedDb.execute(
    sql`DELETE FROM organization_members WHERE organization_id = ${organizationId}`,
  );
  await dropTestOrganization(organizationId);
  if (createdEmails.length) {
    await db.delete(users).where(inArray(users.email, createdEmails));
  }
});

describe("verifyAccessToken - token validity", () => {
  it("accepts a well-formed token and resolves the local user", async () => {
    await seedMember("happy");
    const user = await verifyAccessToken(await sign(validClaims("happy")));

    expect(user.email).toBe(email("happy"));
    expect(user.role).toBe("hiring_manager");
    expect(user.asgardeoUserId).toBe(`${SUFFIX}-happy`);
  });

  it("rejects an expired token", async () => {
    const token = await sign(validClaims("expired"), { expiresIn: "-1s" });
    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      code: "ERR_JWT_EXPIRED",
    });
  });

  it("rejects a token from a different issuer", async () => {
    const token = await sign(validClaims("issuer"), {
      issuer: "https://attacker.example",
    });
    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      claim: "iss",
    });
  });

  it("rejects a token signed by an unknown key", async () => {
    const token = await sign(validClaims("badkey"), { key: otherKey });
    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    });
  });
});

describe("verifyAccessToken - claims", () => {
  it("rejects a token with no sub claim", async () => {
    const claims = validClaims("nosub");
    delete claims.sub;
    await expect(verifyAccessToken(await sign(claims))).rejects.toThrow(
      AuthError,
    );
  });

  it("rejects a token with no email claim", async () => {
    const claims = validClaims("noemail");
    delete claims.email;
    await expect(verifyAccessToken(await sign(claims))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects a role the app does not recognise", async () => {
    const token = await sign(validClaims("norole", { roles: ["viewer"] }));
    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("reads the role from the wso2 claim as well", async () => {
    await seedMember("wso2");
    const token = await sign(
      validClaims("wso2", {
        roles: undefined,
        "http://wso2.org/claims/role": "everyone,Application/x,super admin",
      }),
    );
    const user = await verifyAccessToken(token);
    expect(user.role).toBe("super_admin");
  });
});

describe("verifyAccessToken - user provisioning", () => {
  it("creates the identity but refuses login when the organization is ambiguous", async () => {
    createdEmails.push(email("new"));

    // More than one organization exists here, so nothing can say which one a
    // first-time user belongs to. Attaching them anyway would put a person
    // inside someone else's data, so login is refused instead.
    await expect(
      verifyAccessToken(await sign(validClaims("new"))),
    ).rejects.toThrow(/not attached to an organization/);

    // The identity itself was still created — provisioning and membership are
    // separate steps.
    const found = await unscopedDb.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM users WHERE email = ${email("new")}`,
    );
    expect(found.rows[0]!.count).toBe(1);
  });

  it("returns the same row on a second login", async () => {
    await seedMember("repeat");
    const first = await verifyAccessToken(await sign(validClaims("repeat")));
    const second = await verifyAccessToken(await sign(validClaims("repeat")));

    expect(second.id).toBe(first.id);
  });

  it("reconciles onto the existing row when sub changes for a known email", async () => {
    await seedMember("moved");
    const original = await verifyAccessToken(await sign(validClaims("moved")));

    const withNewSub = await verifyAccessToken(
      await sign(validClaims("moved", { sub: `${SUFFIX}-moved-changed` })),
    );

    expect(withNewSub.id).toBe(original.id);
    expect(withNewSub.asgardeoUserId).toBe(`${SUFFIX}-moved-changed`);
  });

  it("rejects a deactivated account", async () => {
    createdEmails.push(email("inactive"));
    await db.insert(users).values({
      asgardeoUserId: `${SUFFIX}-inactive`,
      firstName: "In",
      lastName: "Active",
      email: email("inactive"),
      isActive: false,
    });

    await expect(
      verifyAccessToken(await sign(validClaims("inactive"))),
    ).rejects.toMatchObject({ status: 403 });
  });
});

function runAuth(headers: Record<string, string>) {
  return new Promise<{ status: number | null; body: unknown; passed: boolean }>(
    (resolve) => {
      let status: number | null = null;
      const finishHandlers: Array<() => void> = [];

      const res = {
        status(code: number) {
          status = code;
          return this;
        },
        json(body: unknown) {
          resolve({ status, body, passed: false });
          return this;
        },
        // The middleware holds the organization's transaction open until the
        // response ends, so the double has to be able to say when that is.
        on(event: string, handler: () => void) {
          if (event === "finish" || event === "close") {
            finishHandlers.push(handler);
          }
          return this;
        },
        headersSent: false,
      } as unknown as Response;

      const next: NextFunction = () => {
        resolve({ status: null, body: null, passed: true });
        // Stand in for the handler completing, so the transaction closes
        // instead of leaking a connection for every test.
        finishHandlers.forEach((h) => h());
      };

      void authMiddleware({ headers } as unknown as Request, res, next);
    },
  );
}

describe("authMiddleware", () => {
  it("rejects a request with no authorization header", async () => {
    const result = await runAuth({});
    expect(result.status).toBe(401);
    expect(result.passed).toBe(false);
  });

  it("rejects a header that is not a Bearer token", async () => {
    const result = await runAuth({ authorization: "Basic abc123" });
    expect(result.status).toBe(401);
  });

  it("maps a bad token to 401 without leaking the reason", async () => {
    const token = await sign(validClaims("mw-expired"), { expiresIn: "-1s" });
    const result = await runAuth({ authorization: `Bearer ${token}` });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Invalid or expired token" });
  });

  it("passes an AuthError status through instead of flattening it to 401", async () => {
    const token = await sign(validClaims("mw-norole", { roles: ["viewer"] }));
    const result = await runAuth({ authorization: `Bearer ${token}` });

    expect(result.status).toBe(403);
  });

  it("calls next and attaches the user for a valid token", async () => {
    await seedMember("mw-ok");
    const token = await sign(validClaims("mw-ok"));
    const result = await runAuth({ authorization: `Bearer ${token}` });

    expect(result.passed).toBe(true);
  });
});

// Sub-organizations (0001 §5) replace the "only one organization" inference
// with an answer the token carries. Both paths have to keep working: an
// install that has adopted them, and one that has not.
describe("verifyAccessToken - organization from the token", () => {
  it("attaches to the organization the token names", async () => {
    const tag = "suborg";
    createdEmails.push(email(tag));
    const asgardeoOrg = `asg-${SUFFIX}`;

    // Inside a context: organizations is policy-protected like everything
    // else, so an unscoped UPDATE here would match no rows and say nothing.
    // `db`, not `unscopedDb`: the latter deliberately bypasses the proxy and
    // so never picks up the context this wraps it in.
    await runInOrganization(organizationId, () =>
      db.execute(
        sql`UPDATE organizations SET asgardeo_org_id = ${asgardeoOrg}
            WHERE id = ${organizationId}`,
      ),
    );

    const user = await verifyAccessToken(
      await sign(validClaims(tag, { org_id: asgardeoOrg })),
    );

    // Resolved from the claim, with no inference from how many organizations
    // happen to exist — and several do, since every suite creates one.
    expect(user.organizationId).toBe(organizationId);

    await runInOrganization(organizationId, () =>
      db.execute(
        sql`UPDATE organizations SET asgardeo_org_id = NULL
            WHERE id = ${organizationId}`,
      ),
    );
  });

  it("refuses a token from an organization that is not set up here", async () => {
    const tag = "unmapped";
    createdEmails.push(email(tag));

    await expect(
      verifyAccessToken(
        await sign(validClaims(tag, { org_id: `never-provisioned-${SUFFIX}` })),
      ),
    ).rejects.toThrow(/organization is not set up/);
  });

  it("still refuses when the token names no organization and several exist", async () => {
    const tag = "noclaim";
    createdEmails.push(email(tag));

    // The single-organization path, unchanged: it declines to guess.
    await expect(
      verifyAccessToken(await sign(validClaims(tag))),
    ).rejects.toThrow(/not attached to an organization/);
  });
});

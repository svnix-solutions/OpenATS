import { createRemoteJWKSet, jwtVerify } from "jose";
import { sql } from "drizzle-orm";
import { resolveMembership, unscopedDb } from "../../db";
import type { User } from "../../db/schema/users";
import logger from "../../utils/logger";

/**
 * Shared Asgardeo access-token verification, used by both the HTTP auth
 * middleware and the Socket.IO handshake. Keeping one implementation means
 * the two transports can never drift apart on who counts as authenticated.
 */

const JWKS = createRemoteJWKSet(new URL(process.env.ASGARDEO_JWKS_URL!));

export type AppRole =
  | "super_admin"
  | "hiring_manager"
  | "interviewer"
  // Client contacts. They belong to one client company and see only its
  // work — see isClientScoped in shared/auth/job-access.ts.
  | "client_admin"
  | "client_reviewer";

export type AuthenticatedUser = User & {
  role: AppRole;
  /** The tenant every query this request makes will be scoped to. */
  organizationId: number;
  /** Set only for client contacts; null for agency staff. */
  clientCompanyId: number | null;
};

/** An authentication failure with the HTTP status it maps to. */
export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function collectRolesFromPayload(
  payload: Record<string, unknown>,
): string[] {
  const out: string[] = [];

  const rolesClaim = payload["roles"];
  if (Array.isArray(rolesClaim)) {
    for (const x of rolesClaim) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  } else if (typeof rolesClaim === "string" && rolesClaim.trim()) {
    out.push(rolesClaim.trim());
  }

  const wso2 = payload["http://wso2.org/claims/role"];
  if (Array.isArray(wso2)) {
    for (const x of wso2) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  } else if (typeof wso2 === "string" && wso2.trim()) {
    for (const part of wso2.split(",")) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }

  return out;
}

/**
 * The Asgardeo sub-organization a token was issued for, if any.
 *
 * B2B tokens carry `org_id`. A token from the root organization does not, and
 * that absence is meaningful: it means this install has not adopted
 * sub-organizations and login falls back to the single-organization path.
 */
export function organizationClaim(
  payload: Record<string, unknown>,
): string | null {
  const value = payload["org_id"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mapToAppRole(names: string[]): AppRole | null {
  const normalized = names.map((s) =>
    s.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " "),
  );
  const has = (pred: (n: string) => boolean) => normalized.some(pred);

  // Exact name or group path only. A substring match would grant full
  // privileges to any role merely containing the words, e.g.
  // "super_admin_readonly" or "ex super admin".
  if (has((n) => n === "super admin" || n.endsWith("/super admin")))
    return "super_admin";
  if (has((n) => n === "hiring manager" || n.endsWith("/hiring manager")))
    return "hiring_manager";
  if (has((n) => n === "interviewer" || n.endsWith("/interviewer")))
    return "interviewer";
  if (has((n) => n === "client admin" || n.endsWith("/client admin")))
    return "client_admin";
  if (has((n) => n === "client reviewer" || n.endsWith("/client reviewer")))
    return "client_reviewer";

  return null;
}

/**
 * Verifies an Asgardeo JWT and resolves it to a local user.
 *
 * Throws `AuthError` for anything the caller should reject (bad claims, no
 * role, deactivated account) and lets `jose` errors and database errors
 * propagate unchanged so callers can tell a bad token from a broken server.
 */
export async function verifyAccessToken(
  token: string,
): Promise<AuthenticatedUser> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: process.env.ASGARDEO_ISSUER!,
  });

  const sub = payload.sub;
  if (!sub) {
    throw new AuthError(401, "Invalid token: missing sub claim");
  }

  // Role is the single source of truth from the JWT — never stored in DB.
  const role = mapToAppRole(
    collectRolesFromPayload(payload as Record<string, unknown>),
  );

  if (!role) {
    throw new AuthError(403, "No role assigned. Contact your administrator.");
  }

  const email = payload["email"] as string | undefined;
  const firstName = (payload["given_name"] as string | undefined) ?? "Unknown";
  const lastName = (payload["family_name"] as string | undefined) ?? "User";

  if (!email) {
    throw new AuthError(403, "Token missing required email claim");
  }

  // Identity resolution runs before any organization is known, so it cannot
  // go through a row-level-security policy that needs one. Both calls below
  // are SECURITY DEFINER functions that take a subject and return an
  // identity — see drizzle/0032_login_provisioning.sql.
  const provisioned = await unscopedDb.execute<{
    id: number;
    asgardeo_user_id: string;
    first_name: string;
    last_name: string;
    email: string;
    avatar_url: string | null;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    sql`SELECT * FROM app_provision_user(${sub}, ${email}, ${firstName}, ${lastName})`,
  );

  const row = provisioned.rows[0];
  if (!row) {
    throw new AuthError(500, "Failed to provision user");
  }

  // Raw SQL comes back in the database's snake_case, not the schema's
  // camelCase, so this mapping is deliberate rather than a spread.
  const user: User = {
    id: row.id,
    asgardeoUserId: row.asgardeo_user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  const asgardeoOrg = organizationClaim(payload as Record<string, unknown>);

  if (asgardeoOrg) {
    // The token names its organization, so there is nothing to infer.
    const attached = await unscopedDb.execute<{
      app_attach_membership_by_asgardeo_org: number | null;
    }>(
      sql`SELECT app_attach_membership_by_asgardeo_org(${user.id}, ${asgardeoOrg})`,
    );

    if (!attached.rows[0]?.app_attach_membership_by_asgardeo_org) {
      // The sub-organization exists in the identity provider but not here.
      // Inventing a tenant would be worse than refusing.
      logger.warn(
        `[auth] token for unmapped Asgardeo organization ${asgardeoOrg}`,
      );
      throw new AuthError(
        403,
        "Your organization is not set up in OpenATS. Contact your administrator.",
      );
    }
  } else {
    // No organization on the token: this install has not adopted
    // sub-organizations. Attaches only when a single organization exists, and
    // declines to guess otherwise.
    await unscopedDb.execute(
      sql`SELECT app_attach_default_membership(${user.id})`,
    );
  }

  const membership = await resolveMembership(sub);
  if (!membership) {
    throw new AuthError(
      403,
      "Your account is not attached to an organization. Contact your administrator.",
    );
  }

  if (!user.isActive) {
    throw new AuthError(403, "User account is deactivated");
  }

  // Role still comes from the JWT. organization_members.role exists for the
  // client portal in phase 3 and is deliberately not read yet.
  return {
    ...user,
    role,
    organizationId: membership.organizationId,
    clientCompanyId: membership.clientCompanyId,
  };
}

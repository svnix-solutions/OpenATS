import { eq, or } from "drizzle-orm";
import { currentOrganizationId, db } from "../../db";
import { clientCompanies, organizationMembers, users } from "../../db/schema";
import { orgRole } from "../../db/schema/enums";
import { cleanObject as clean } from "../../utils/object.utils";

export interface UpdateUserInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  avatarUrl?: string | null | undefined;
  isActive?: boolean | undefined;
}

export interface CreateUserInput {
  providerUserId: string;
  firstName: string;
  lastName: string;
  email: string;
}

export const userService = {
  /**
   * Members of this organization, with the role and client company that
   * actually govern what they see.
   *
   * An inner join, not a left one. The policy on `users` admits members of
   * the current organization *or* users who belong to no organization at all —
   * the second clause so a just-provisioned account is visible before it is
   * attached. Selecting from `users` alone therefore also returned every
   * unattached account on the install. Joining the membership restricts this
   * to actual members, and carries the two columns the caller needs anyway.
   */
  async getAll() {
    return db
      .select({
        id: users.id,
        providerUserId: users.providerUserId,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        role: organizationMembers.role,
        clientCompanyId: organizationMembers.clientCompanyId,
      })
      .from(users)
      .innerJoin(
        organizationMembers,
        eq(organizationMembers.userId, users.id),
      )
      .where(eq(users.isActive, true))
      .orderBy(users.firstName);
  },

  async getById(id: number) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user ?? null;
  },

  async getByProviderId(providerUserId: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.providerUserId, providerUserId));
    return user ?? null;
  },

  async create(input: CreateUserInput) {
    // Reactivate soft-deleted row on re-creation rather than inserting a duplicate.
    const [existing] = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.email, input.email),
          eq(users.providerUserId, input.providerUserId),
        ),
      )
      .limit(1);

    if (existing) {
      const [reactivated] = await db
        .update(users)
        .set({
          providerUserId: input.providerUserId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return reactivated;
    }

    const [created] = await db.insert(users).values(input).returning();
    return created;
  },

  async update(id: number, input: UpdateUserInput) {
    const [updated] = await db
      .update(users)
      .set({ ...clean(input), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated ?? null;
  },

  async deactivate(id: number) {
    const [updated] = await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated ?? null;
  },
};

/**
 * A user's place in this organization: what they may do, and — for a client
 * contact — whose work they may see.
 *
 * Both live on `organization_members` rather than on `users`, because `users`
 * is a global identity and the same person could in principle be a manager in
 * one organization and a client contact in another.
 */
export type MembershipInput = {
  role?: (typeof orgRole.enumValues)[number];
  clientCompanyId?: number | null;
};

export class MembershipNotFoundError extends Error {
  constructor() {
    super("That user is not a member of this organization");
    this.name = "MembershipNotFoundError";
  }
}

export class ClientCompanyRequiredError extends Error {
  constructor() {
    super("A client role needs a client company");
    this.name = "ClientCompanyRequiredError";
  }
}

export class UnknownClientCompanyError extends Error {
  constructor() {
    super("No such client company in this organization");
    this.name = "UnknownClientCompanyError";
  }
}

/**
 * Places a newly created account in this organization.
 *
 * Split from `membershipService.update` on purpose: that one refuses to create,
 * because it takes a user id from a request and cannot tell a new account from
 * someone else's. This is only reachable from the code path that just created
 * the account.
 */
export async function placeNewMember(
  userId: number,
  role: (typeof orgRole.enumValues)[number],
  clientCompanyId: number | null = null,
) {
  const organizationId = currentOrganizationId();
  if (organizationId === null) {
    throw new Error("Cannot create a membership outside an organization");
  }

  const [created] = await db
    .insert(organizationMembers)
    .values({ organizationId, userId, role, clientCompanyId })
    .onConflictDoNothing()
    .returning();

  return created ?? null;
}

export const membershipService = {
  async get(userId: number) {
    const [row] = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .limit(1);
    return row ?? null;
  },

  /**
   * Changing this is the only way a role change takes effect. The role on the
   * token seeds this column at first sign-in and is ignored afterwards, so
   * updating the identity provider alone changes nothing.
   */
  async update(userId: number, input: MembershipInput) {
    const current = await this.get(userId);
    // Deliberately strict. Creating a membership here would let an
    // administrator grant one to any user id — including a person who belongs
    // to another organization, who would then appear in this one's directory.
    // A brand-new account gets its membership from `create` below, which knows
    // the account is new because it just made it.
    if (!current) throw new MembershipNotFoundError();

    const role = input.role ?? current.role;
    const clientCompanyId =
      input.clientCompanyId === undefined
        ? current.clientCompanyId
        : input.clientCompanyId;

    // The same rule verify-token enforces at sign-in: a client contact with no
    // company has no coherent view, so it is refused rather than stored.
    if (isClientOrgRole(role) && clientCompanyId === null) {
      throw new ClientCompanyRequiredError();
    }

    // Agency staff are not scoped to a client, and leaving a stale link on a
    // demoted account is how someone keeps a narrower view than their role.
    const resolved = isClientOrgRole(role) ? clientCompanyId : null;

    if (resolved !== null) {
      // Policy-filtered, so this also proves the company belongs to this
      // organization rather than merely existing.
      const [company] = await db
        .select({ id: clientCompanies.id })
        .from(clientCompanies)
        .where(eq(clientCompanies.id, resolved))
        .limit(1);
      if (!company) throw new UnknownClientCompanyError();
    }

    const [updated] = await db
      .update(organizationMembers)
      .set({ role, clientCompanyId: resolved, updatedAt: new Date() })
      .where(eq(organizationMembers.userId, userId))
      .returning();

    return updated ?? null;
  },
};

function isClientOrgRole(role: string): boolean {
  return role === "client_admin" || role === "client_reviewer";
}

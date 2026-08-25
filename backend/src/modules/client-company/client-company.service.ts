import { and, asc, eq, ne } from "drizzle-orm";
import { currentOrganizationId, db } from "../../db";
import { clientCompanies, jobs } from "../../db";

export type ClientCompanyInput = {
  name: string;
  slug: string;
  website?: string | null | undefined;
  description?: string | null | undefined;
  logoUrl?: string | null | undefined;
};

/** Raised when a slug is already taken inside this organization. */
export class DuplicateSlugError extends Error {
  constructor() {
    super("A client company with that URL slug already exists");
    this.name = "DuplicateSlugError";
  }
}

/** Raised when a company still has jobs; deleting it would orphan them. */
export class ClientCompanyInUseError extends Error {
  constructor(public readonly jobCount: number) {
    super("This client company still has jobs");
    this.name = "ClientCompanyInUseError";
  }
}

/**
 * The companies an agency recruits for. Every job belongs to one, and the slug
 * is what addresses their careers page at /careers/:slug.
 *
 * Every query here is filtered by the row-level policy, so none of them name
 * an organization.
 */
export const clientCompanyService = {
  async getAll() {
    return db
      .select()
      .from(clientCompanies)
      .orderBy(asc(clientCompanies.name));
  },

  async getById(id: number) {
    const [row] = await db
      .select()
      .from(clientCompanies)
      .where(eq(clientCompanies.id, id))
      .limit(1);
    return row ?? null;
  },

  async create(input: ClientCompanyInput) {
    if (await slugTaken(input.slug)) throw new DuplicateSlugError();

    // Named explicitly, unlike most tables. client_companies is part of the
    // tenancy skeleton and its organization_id has no app_current_org()
    // default, so there is nothing to fall back on. Reads are still filtered
    // by the policy; this is only about the insert.
    const organizationId = currentOrganizationId();
    if (organizationId === null) {
      throw new Error("Cannot create a client company outside an organization");
    }

    const [row] = await db
      .insert(clientCompanies)
      .values({
        organizationId,
        name: input.name,
        slug: input.slug,
        website: input.website ?? null,
        description: input.description ?? null,
        logoUrl: input.logoUrl ?? null,
      })
      .returning();
    return row ?? null;
  },

  async update(id: number, input: ClientCompanyInput) {
    if (await slugTaken(input.slug, id)) throw new DuplicateSlugError();

    const [row] = await db
      .update(clientCompanies)
      .set({
        name: input.name,
        slug: input.slug,
        website: input.website ?? null,
        description: input.description ?? null,
        logoUrl: input.logoUrl ?? null,
        updatedAt: new Date(),
      })
      .where(eq(clientCompanies.id, id))
      .returning();
    return row ?? null;
  },

  async remove(id: number) {
    // jobs.client_company_id is NOT NULL with ON DELETE RESTRICT, so the
    // database would refuse this anyway — but as a foreign key violation
    // surfacing as a 500. Counting first turns it into an answer.
    const attached = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.clientCompanyId, id));

    if (attached.length > 0) {
      throw new ClientCompanyInUseError(attached.length);
    }

    const [row] = await db
      .delete(clientCompanies)
      .where(eq(clientCompanies.id, id))
      .returning({ id: clientCompanies.id });
    return row ?? null;
  },
};

/**
 * Whether this slug is taken, ignoring one row so an update can keep its own.
 *
 * There is a unique index on (organization_id, slug) that is the real
 * guarantee; this exists to answer with a 409 rather than a constraint error.
 */
async function slugTaken(slug: string, exceptId?: number): Promise<boolean> {
  const clash = exceptId
    ? and(eq(clientCompanies.slug, slug), ne(clientCompanies.id, exceptId))
    : eq(clientCompanies.slug, slug);

  const [row] = await db
    .select({ id: clientCompanies.id })
    .from(clientCompanies)
    .where(clash)
    .limit(1);

  return !!row;
}

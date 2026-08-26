import { describe, expect } from "vitest";
import { Client } from "pg";
import { assertTenancyIsEnforceable, rlsExemption } from "../../src/db";
import { it } from "vitest";

/**
 * The whole tenancy boundary is policies on tables, and Postgres exempts
 * superusers and BYPASSRLS roles from them. A connection made as one of those
 * reads every tenant's rows while looking entirely normal — no error, no log
 * line, nothing to notice until someone sees another company's candidates.
 *
 * The E2E suite ran that way, so this is a guard against a mistake already
 * made rather than an imagined one.
 */
describe("the role the application connects as", () => {
  it("is not exempt from row-level security", async () => {
    await expect(assertTenancyIsEnforceable()).resolves.toBeUndefined();
  });

  it("is what the tests themselves are using", async () => {
    // Otherwise the check above could pass while the suite ran as somebody
    // else entirely, which is the failure mode it exists to catch.
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    } finally {
      await client.end();
    }
  });

  it("stops the process rather than serving with the boundary off", async () => {
    // The predicate above says what is wrong; this is the part that acts on
    // it. Without this, deleting the throw leaves every other test passing.
    const asSuperuser = {
      query: <T,>() =>
        Promise.resolve({
          rows: [
            { rolname: "openats", rolsuper: true, rolbypassrls: false },
          ] as T[],
        }),
    };
    await expect(assertTenancyIsEnforceable(asSuperuser)).rejects.toThrow(
      /superuser/,
    );
  });

  it("refuses a superuser, and says why", () => {
    const complaint = rlsExemption({
      rolname: "openats",
      rolsuper: true,
      rolbypassrls: false,
    });
    expect(complaint).toMatch(/superuser/);
    expect(complaint).toMatch(/openats_app/);
  });

  it("refuses BYPASSRLS even when not a superuser", () => {
    expect(
      rlsExemption({ rolname: "reader", rolsuper: false, rolbypassrls: true }),
    ).toMatch(/BYPASSRLS/);
  });

  it("accepts an ordinary role, including the table owner", () => {
    // Owning the tables is fine: the policies are FORCEd, so they apply to the
    // owner too. Only the two exemptions defeat them.
    expect(
      rlsExemption({ rolname: "openats_app", rolsuper: false, rolbypassrls: false }),
    ).toBeNull();
  });
});

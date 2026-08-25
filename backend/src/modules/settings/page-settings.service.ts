import { eq, sql } from "drizzle-orm";
import { db, unscopedDb } from "../../db";
import { pageSettings } from "../../db/schema";

export const pageSettingsService = {
  /**
   * Every origin any organization allows, for the CORS check.
   *
   * Not a policy-filtered read, and it cannot be: CORS answers before routing,
   * so no tenant has been resolved and an Origin header does not name one.
   * Through the policy this returned nothing, which refused every custom
   * careers-page domain while the settings page listed them as allowed.
   *
   * `app_allowed_origins()` is SECURITY DEFINER and returns origins only —
   * never which organization configured them. See migration 0044 for why that
   * is an acceptable hole and what it must not become.
   *
   * Use `getAllowedOriginsForOrganization` for anything a tenant is shown.
   */
  async getAllowedOrigins(): Promise<string[]> {
    const result = await unscopedDb.execute<{ app_allowed_origins: string[] }>(
      sql`SELECT app_allowed_origins()`,
    );
    return result.rows[0]?.app_allowed_origins ?? [];
  },

  /** This organization's own origins, for showing and editing them. */
  async getAllowedOriginsForOrganization(): Promise<string[]> {
    const [row] = await db.select().from(pageSettings).limit(1);
    return row?.allowedOrigins ?? [];
  },

  async setAllowedOrigins(origins: string[]): Promise<string[]> {
    const [existing] = await db.select().from(pageSettings).limit(1);
    const now = new Date();

    if (existing) {
      await db
        .update(pageSettings)
        .set({ allowedOrigins: origins, updatedAt: now })
        .where(eq(pageSettings.id, existing.id));
    } else {
      await db.insert(pageSettings).values({ allowedOrigins: origins });
    }

    return this.getAllowedOrigins();
  },
};

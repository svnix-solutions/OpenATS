import { and, eq } from "drizzle-orm";
import { currentOrganizationId, runInOrganization, db } from "../../db";
import { integrationConnections } from "../../db";
import { decrypt, encrypt, signState, verifyState } from "./crypto";
import { getProviderClient } from "./registry";

const STATE_TTL_SECONDS = 10 * 60;
const REFRESH_BUFFER_MS = 5 * 60_000;

export type ConnectionStatus = {
  provider: "google_meet";
  connected: boolean;
  accountEmail: string | null;
};

export const integrationConnectionService = {
  getAuthUrl(userId: number): string {
    // Established by the authenticated route this is reached from. Failing
    // here is deliberate: the alternative is a state token that cannot say
    // which tenant to write the connection back into.
    const organizationId = currentOrganizationId();
    if (organizationId === null) {
      throw new Error("Cannot start an OAuth flow outside an organization");
    }

    const state = signState({ userId, organizationId }, STATE_TTL_SECONDS);
    return getProviderClient("google_meet").getAuthUrl(state);
  },

  async handleCallback(code: string, state: string): Promise<void> {
    const { userId, organizationId } = verifyState(state);
    const result = await getProviderClient("google_meet").exchangeCode(code);

    // The provider redirects to a route with no session, so nothing has
    // established a tenancy context by this point. Without one the insert
    // below is refused — organization_id defaults to app_current_org(), which
    // is null out here — and the user is redirected to an error having just
    // been told the connection succeeded.
    await runInOrganization(organizationId, () =>
      db
      .insert(integrationConnections)
      .values({
        userId,
        provider: "google_meet",
        accessTokenEncrypted: encrypt(result.accessToken),
        refreshTokenEncrypted: encrypt(result.refreshToken),
        expiresAt: result.expiresAt,
        scopes: result.scopes,
        providerAccountEmail: result.accountEmail,
        updatedAt: new Date(),
      })
        .onConflictDoUpdate({
          target: [
            integrationConnections.userId,
            integrationConnections.provider,
          ],
          set: {
            accessTokenEncrypted: encrypt(result.accessToken),
            refreshTokenEncrypted: encrypt(result.refreshToken),
            expiresAt: result.expiresAt,
            scopes: result.scopes,
            providerAccountEmail: result.accountEmail,
            updatedAt: new Date(),
          },
        }),
    );
  },

  async getStatus(userId: number): Promise<ConnectionStatus[]> {
    const rows = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.userId, userId));

    const google = rows.find((r) => r.provider === "google_meet");
    return [
      {
        provider: "google_meet",
        connected: !!google,
        accountEmail: google?.providerAccountEmail ?? null,
      },
    ];
  },

  async disconnect(userId: number): Promise<void> {
    await db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.userId, userId),
          eq(integrationConnections.provider, "google_meet"),
        ),
      );
  },

  /**
   * Returns a usable access token for the given user's Google connection,
   * refreshing it first if it's within the expiry buffer. Returns null if
   * the user has no connection at all — callers treat that as "not connected".
   */
  async getValidAccessToken(userId: number): Promise<string | null> {
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.userId, userId),
          eq(integrationConnections.provider, "google_meet"),
        ),
      )
      .limit(1);

    if (!row) return null;

    if (row.expiresAt.getTime() - REFRESH_BUFFER_MS > Date.now()) {
      return decrypt(row.accessTokenEncrypted);
    }

    const refreshToken = decrypt(row.refreshTokenEncrypted);
    const refreshed = await getProviderClient("google_meet").refreshAccessToken(refreshToken);

    await db
      .update(integrationConnections)
      .set({
        accessTokenEncrypted: encrypt(refreshed.accessToken),
        // Providers may rotate the refresh token on every use — always persist
        // whatever comes back rather than assuming the original stays valid.
        refreshTokenEncrypted: refreshed.refreshToken
          ? encrypt(refreshed.refreshToken)
          : row.refreshTokenEncrypted,
        expiresAt: refreshed.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.id, row.id));

    return refreshed.accessToken;
  },
};

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";

// The provider is the one thing that cannot run in a test: it would make a
// real token exchange against Google. Everything below it is real.
const exchangeCode = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    accountEmail: "connected@example.test",
  }),
);

vi.mock("../../src/shared/integrations/registry", () => ({
  getProviderClient: () => ({
    exchangeCode,
    getAuthUrl: (state: string) => `https://accounts.google.test/o?state=${state}`,
  }),
}));

import { db, runInOrganization } from "../../src/db";
import { users } from "../../src/db/schema/users";
import { integrationConnections } from "../../src/db";
import { integrationConnectionService } from "../../src/shared/integrations/connection.service";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `oauth-${Date.now()}`;
let organizationId: number;
let userId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
  await runInOrganization(organizationId, async () => {
    const [row] = await db
      .insert(users)
      .values({
        asgardeoUserId: SUFFIX,
        firstName: "OAuth",
        lastName: "Tester",
        email: `${SUFFIX}@example.test`,
      })
      .returning({ id: users.id });
    userId = row!.id;
  });
});

afterAll(async () => {
  await dropTestOrganization(organizationId);
});

describe("google OAuth callback", () => {
  it("persists the connection into the organization the flow started in", async () => {
    // Starting the flow is authenticated, so it runs inside a context. The
    // callback is not: the provider redirects to a route with no session and
    // no token, which is why the organization has to travel in the state.
    const url = await runInOrganization(organizationId, async () =>
      integrationConnectionService.getAuthUrl(userId),
    );
    const state = new URL(url).searchParams.get("state")!;

    // Deliberately outside any context, exactly as the real callback runs.
    await integrationConnectionService.handleCallback("auth-code", state);

    const [row] = await runInOrganization(organizationId, () =>
      db
        .select()
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.userId, userId),
            eq(integrationConnections.provider, "google_meet"),
          ),
        ),
    );

    expect(row).toBeDefined();
    expect(row!.providerAccountEmail).toBe("connected@example.test");
    expect(row!.organizationId).toBe(organizationId);
  });

  it("refuses to start a flow with no organization to come back to", async () => {
    // A state token that cannot name a tenant produces a connection that can
    // never be written. Failing here beats failing after the round trip.
    expect(() => integrationConnectionService.getAuthUrl(userId)).toThrow();
  });

  it("rejects a state token whose organization was tampered with", async () => {
    const url = await runInOrganization(organizationId, async () =>
      integrationConnectionService.getAuthUrl(userId),
    );
    const state = new URL(url).searchParams.get("state")!;
    const [body, signature] = state.split(".");

    const payload = JSON.parse(
      Buffer.from(body!, "base64url").toString("utf8"),
    );
    payload.organizationId = organizationId + 1;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;

    await expect(
      integrationConnectionService.handleCallback("auth-code", forged),
    ).rejects.toThrow();
  });
});

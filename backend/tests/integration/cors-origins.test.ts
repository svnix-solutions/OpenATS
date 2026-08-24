import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, runInOrganization } from "../../src/db";
import { pageSettings } from "../../src/db/schema/page-settings";
import { pageSettingsService } from "../../src/modules/settings/page-settings.service";
import {
  createTestOrganization,
  dropTestOrganization,
} from "../helpers/scenario";

const SUFFIX = `cors-${Date.now()}`;
const ORIGIN = `https://careers.${SUFFIX}.example`;
let organizationId: number;

beforeAll(async () => {
  organizationId = await createTestOrganization(SUFFIX);
  await runInOrganization(organizationId, () =>
    db.insert(pageSettings).values({ allowedOrigins: [ORIGIN] }),
  );
});

afterAll(async () => {
  await dropTestOrganization(organizationId);
});

describe("CORS allowed origins", () => {
  it("finds the configured origin from inside the organization", async () => {
    const origins = await runInOrganization(organizationId, () =>
      pageSettingsService.getAllowedOriginsForOrganization(),
    );
    expect(origins).toContain(ORIGIN);
  });

  it("keeps one organization's origins out of another's list", async () => {
    // getAllowedOriginsForOrganization is what the public-route check and the
    // settings page both read. If it ever answered globally, one agency
    // configuring an origin would start refusing every other agency's careers
    // page, and the settings screen would list domains they do not own.
    const other = await createTestOrganization(`${SUFFIX}-other`);
    try {
      const origins = await runInOrganization(other, () =>
        pageSettingsService.getAllowedOriginsForOrganization(),
      );
      expect(origins).not.toContain(ORIGIN);
    } finally {
      await dropTestOrganization(other);
    }
  });

  it("finds it from the CORS middleware, which has no organization", async () => {
    // The CORS callback runs before routing, so nothing has resolved a tenant
    // yet — and an origin does not name one. Read through the policy it would
    // return nothing, and every custom careers-page domain would be refused
    // while the settings page went on claiming it was allowed.
    const origins = await pageSettingsService.getAllowedOrigins();
    expect(origins).toContain(ORIGIN);
  });
});

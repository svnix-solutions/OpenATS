import { describe, it, expect } from "vitest";
import { isClientRole, isClientRoute, CLIENT_HOME } from "@/lib/roles";

describe("isClientRole", () => {
  it("is true for the two client roles and false for agency staff", () => {
    expect(isClientRole("client_admin")).toBe(true);
    expect(isClientRole("client_reviewer")).toBe(true);
    expect(isClientRole("super_admin")).toBe(false);
    expect(isClientRole("hiring_manager")).toBe(false);
    expect(isClientRole("interviewer")).toBe(false);
  });

  it("is false while the role is still unknown", () => {
    // The gate reads this before the user query resolves. Treating undefined
    // as a client would bounce agency staff off their own dashboard on every
    // cold load.
    expect(isClientRole(undefined)).toBe(false);
  });
});

describe("isClientRoute", () => {
  it("allows the client routes and their children", () => {
    expect(isClientRoute("/jobs")).toBe(true);
    expect(isClientRoute("/jobs/42")).toBe(true);
    expect(isClientRoute("/candidates/7")).toBe(true);
    expect(isClientRoute("/interviews")).toBe(true);
    expect(isClientRoute("/settings/profile")).toBe(true);
  });

  it("refuses agency tooling", () => {
    expect(isClientRoute("/")).toBe(false);
    expect(isClientRoute("/offers")).toBe(false);
    expect(isClientRoute("/templates")).toBe(false);
    expect(isClientRoute("/assessments")).toBe(false);
    expect(isClientRoute("/settings/general")).toBe(false);
    expect(isClientRoute("/settings/user-management")).toBe(false);
  });

  it("does not let a prefix match open a route", () => {
    // "/jobs" must not admit "/jobsecret". Matching on startsWith alone is
    // the usual way this goes wrong.
    expect(isClientRoute("/jobsecret")).toBe(false);
    expect(isClientRoute("/candidates-export")).toBe(false);
    expect(isClientRoute("/settings/profiles-admin")).toBe(false);
  });

  it("sends clients somewhere they are allowed", () => {
    expect(isClientRoute(CLIENT_HOME)).toBe(true);
  });
});

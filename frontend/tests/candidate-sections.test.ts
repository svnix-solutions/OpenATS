import { describe, it, expect } from "vitest";
import {
  SECTIONS,
  sectionsFor,
  canSeeSection,
} from "@/app/(dashboard)/candidates/[id]/_components/constants";

describe("candidate sections for a client contact", () => {
  const hidden = ["job-fit", "rejection", "email"];

  it("hides the agency's own working sections", () => {
    const ids = sectionsFor(true).map((s) => s.id);
    for (const id of hidden) expect(ids).not.toContain(id);
  });

  it("leaves agency staff everything", () => {
    expect(sectionsFor(false)).toHaveLength(SECTIONS.length);
  });

  it("never leaves a client with nothing to open", () => {
    // The page falls back to the first of these when no section is chosen, so
    // an empty list would render nothing at all.
    expect(sectionsFor(true).length).toBeGreaterThan(0);
  });

  it("does not default a client onto a hidden section", () => {
    // The bug: the page's default was a fixed "job-fit", which is hidden from
    // a client — so they landed on a panel whose tab was not in the bar.
    const first = sectionsFor(true)[0]!.id;
    expect(canSeeSection(first, true)).toBe(true);
    expect(hidden).not.toContain(first);
  });

  it("refuses a hidden section even when it is somehow active", () => {
    // Hiding a tab is not the same as the panel refusing to draw; the panels
    // were rendered off the raw active section.
    for (const id of hidden) {
      expect(canSeeSection(id as never, true)).toBe(false);
      expect(canSeeSection(id as never, false)).toBe(true);
    }
  });
});

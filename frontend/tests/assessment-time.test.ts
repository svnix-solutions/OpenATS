import { describe, it, expect } from "vitest";
import {
  timeLimitMinutes,
  timeLimitSeconds,
} from "@/app/assessment/_lib/assessment-types";
import type { AttemptData } from "@/app/assessment/_lib/assessment-types";

function attempt(timeLimit: number): AttemptData {
  return { assessment: { timeLimit } } as AttemptData;
}

describe("assessment time limit", () => {
  it("reads the stored value as minutes", () => {
    // The dashboard enters and renders this as minutes: default "120",
    // displayed as `{timeLimit}m`.
    expect(timeLimitMinutes(attempt(120))).toBe(120);
    expect(timeLimitMinutes(attempt(30))).toBe(30);
  });

  it("converts to seconds for the countdown", () => {
    // The countdown previously seeded itself with the raw value, so a
    // 120-minute assessment expired after 120 seconds.
    expect(timeLimitSeconds(attempt(120))).toBe(7200);
    expect(timeLimitSeconds(attempt(30))).toBe(1800);
  });

  it("does not round a short assessment down to nothing", () => {
    // The intro screen used to divide by 60, so a 30-minute assessment
    // announced "0 minutes".
    expect(timeLimitMinutes(attempt(30))).toBeGreaterThan(0);
    expect(timeLimitSeconds(attempt(1))).toBe(60);
  });

  it("treats a missing limit as zero rather than NaN", () => {
    expect(timeLimitMinutes({ assessment: {} } as AttemptData)).toBe(0);
    expect(timeLimitSeconds({ assessment: {} } as AttemptData)).toBe(0);
  });
});

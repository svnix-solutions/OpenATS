import { isClientScoped } from "./job-access";
import type { AuthenticatedUser } from "./verify-token";

/**
 * What a client contact is shown of a candidate.
 *
 * A client can reach their own company's candidates, but not the agency's
 * working view of them. Two things are withheld and it is worth being explicit
 * about why, because both look like ordinary fields:
 *
 *   - **Contact details.** Agencies withhold a candidate's email and phone
 *     until a placement is agreed. Handing them over is handing over the
 *     ability to hire around the agency, which is the agency's whole business.
 *
 *   - **The agency's assessment.** CV match scores and AI summaries are the
 *     agency's internal judgement of someone they are putting forward. A
 *     client seeing "weak_fit" on a candidate they were sent is a problem of a
 *     different kind entirely.
 *
 * Rejection records go too: they carry `internalNote`, which is written on the
 * assumption nobody outside the agency reads it.
 *
 * Deliberately a whitelist of removals rather than a rebuild of the object. A
 * rebuild silently drops any field added later; this way a new field is
 * visible by default and someone has to decide to hide it — which is the
 * failure that gets noticed rather than the one that does not.
 */
export function presentCandidate<
  T extends {
    email?: unknown;
    phone?: unknown;
    cvAnalysis?: unknown;
    rejections?: unknown;
  },
>(candidate: T, viewer: AuthenticatedUser): T {
  if (!isClientScoped(viewer)) return candidate;

  return {
    ...candidate,
    ...("email" in candidate ? { email: null } : {}),
    ...("phone" in candidate ? { phone: null } : {}),
    ...("cvAnalysis" in candidate ? { cvAnalysis: null } : {}),
    ...("rejections" in candidate ? { rejections: [] } : {}),
  };
}

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

/**
 * The same withholding, for the shapes that do not put contact details at the
 * top level.
 *
 * Candidate contact details reach a client through three different shapes:
 * flat `email`/`phone` on a candidate row, a nested `candidate` object on an
 * offer, and a flattened `candidateEmail` on an assessment attempt. Only the
 * first was redacted, so a client contact could read the email off an offer or
 * an assessment result — the field the agency's whole business depends on
 * withholding.
 *
 * These live here, next to `presentCandidate`, so the rule has one home. The
 * thing that stops the next shape being missed is the test that sweeps every
 * client-reachable endpoint looking for the candidate's real address.
 */
export function presentOfferRow<
  T extends { candidate?: { email?: unknown; phone?: unknown } | null },
>(row: T, viewer: AuthenticatedUser): T {
  if (!isClientScoped(viewer) || !row.candidate) return row;

  return {
    ...row,
    candidate: {
      ...row.candidate,
      ...("email" in row.candidate ? { email: null } : {}),
      ...("phone" in row.candidate ? { phone: null } : {}),
    },
  };
}

export function presentAttempt<
  T extends { candidateEmail?: unknown; candidatePhone?: unknown },
>(attempt: T, viewer: AuthenticatedUser): T {
  if (!isClientScoped(viewer)) return attempt;

  return {
    ...attempt,
    ...("candidateEmail" in attempt ? { candidateEmail: null } : {}),
    ...("candidatePhone" in attempt ? { candidatePhone: null } : {}),
  };
}

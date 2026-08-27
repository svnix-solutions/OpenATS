/**
 * The URLs a candidate is sent, in one place.
 *
 * These are the only pages someone outside the agency ever opens, and each is
 * reached by a token rather than a login. Getting one wrong is not a broken
 * layout — it is a candidate who cannot accept their offer, confirm their
 * interview, or take their assessment, with nothing in any log to say so.
 *
 * They live here because the offer link was being built in two places that
 * disagreed: `offer.service` sent `/offer/<token>`, which is the candidate's
 * page, while `{{offer_review_url}}` — the variable a recruiter puts in an
 * offer template, and therefore the link most candidates actually receive —
 * built `/offers/<token>`. That is the *dashboard* route, so it bounced them
 * to a login page they have no account for.
 *
 * The singular/plural pairs are the trap: /offer vs /offers, /interview vs
 * /interviews, /assessment vs /assessments. In every case the candidate's page
 * is the singular one and the agency's list is the plural.
 */

function frontendBase(): string {
  return (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/** Where a candidate reviews, accepts or declines an offer. */
export function offerReviewUrl(reviewToken: string): string {
  return `${frontendBase()}/offer/${reviewToken}`;
}

/** Where a candidate picks a time for an interview. */
export function interviewUrl(publicToken: string): string {
  return `${frontendBase()}/interview/${publicToken}`;
}

/** Where a candidate takes an assessment. */
export function assessmentUrl(token: string): string {
  return `${frontendBase()}/assessment/${token}`;
}

/** A client company's public careers page. */
export function careersUrl(clientSlug: string): string {
  return `${frontendBase()}/careers/${clientSlug}`;
}

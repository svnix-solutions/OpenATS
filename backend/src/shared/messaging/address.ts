/**
 * Turning a phone number someone typed into the address a channel uses.
 *
 * These have to agree exactly, and it is not obvious that they do. WhatsApp's
 * webhook identifies a sender in `from` as digits with no `+` and no
 * separators — `491701234567`. A candidate typing their number into an
 * application form writes `+49 170 123 4567`, or `0049-170-1234567`. Stored as
 * typed, the webhook would never match it, and every reply would be dropped as
 * coming from a number nobody recognises.
 *
 * So both sides go through here.
 */

/** Shortest number that could plausibly be real, once a country code is on it. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // E.164's own limit.

/**
 * `+49 170 123 4567` → `491701234567`, or null if it cannot be one.
 *
 * A leading `00` is the other way of writing `+`, and is dropped for the same
 * reason: it is not part of the number.
 */
export function toChannelAddress(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const trimmed = phone.trim();
  const withoutPrefix = trimmed.startsWith("00") ? trimmed.slice(2) : trimmed;
  const digits = withoutPrefix.replace(/\D/g, "");

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

  // A number with no country code is ambiguous — 07700 900123 is a different
  // person in every country — and guessing one from the agency's location
  // would silently message a stranger. Refusing is the honest answer.
  if (!trimmed.startsWith("+") && !trimmed.startsWith("00")) return null;

  return digits;
}

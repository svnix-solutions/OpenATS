/**
 * Reading environment variables where blank means unset.
 *
 * `process.env.X ?? fallback` does not do that. `??` falls back only on
 * `undefined`, and an unset variable is not how a blank one usually arrives:
 * `.env.example` ships keys with no value and `make setup` copies the file
 * verbatim, and `${VAR:-}` in a compose file passes an empty string rather
 * than omitting the variable. So the fallback is skipped and `""` is used.
 *
 * Twice now that has stopped the server booting on a value nobody had opted
 * into. `SENTRY_DSN=` failed URL validation before anyone had turned on error
 * tracking. `R2_REGION=` reached the AWS SDK as `region: ""`, which it rejects
 * with "Region is missing" — a message naming a variable that is, from the
 * operator's point of view, right there in the file.
 */

/** An environment variable, treating blank as unset. */
export function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value;
}

/**
 * A numeric environment variable, treating blank or unparseable as unset.
 *
 * `Number("")` is `0`, which is the dangerous case rather than a merely wrong
 * one: as a rate limit it means every request is refused, and as a port it
 * means the OS picks one.
 */
export function envNumberOr(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

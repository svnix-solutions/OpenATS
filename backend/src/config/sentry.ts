import * as Sentry from "@sentry/node";
import { currentOrganizationId } from "../db/org-context";

/**
 * Error tracking. Does nothing unless SENTRY_DSN is set, which is what keeps
 * development, CI and the test suite from reporting into a real project.
 *
 * Must run before the modules it instruments are imported — see the comment
 * at the top of server.ts.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    // Set by the deploy so an error can be tied to the commit that shipped it.
    release: process.env.SENTRY_RELEASE,

    // This is an applicant tracking system: the request bodies, headers and
    // cookies this would attach are candidates' personal data, and Sentry is
    // not where that belongs. Left off deliberately rather than by default.
    sendDefaultPii: false,

    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });

  Sentry.addEventProcessor(tagOrganization);
}

/**
 * Stamps an event with the tenant it came from.
 *
 * Row-level security separates tenants' data and does nothing for error
 * reports, and "a customer reports an error" starts with knowing whose.
 *
 * Named and exported rather than inlined into `addEventProcessor` so it can
 * be tested for what it does: the SDK prepares events asynchronously, so
 * asserting through `captureException` tests the SDK's scheduling more than
 * this rule.
 */
export function tagOrganization<T extends { tags?: Record<string, unknown> }>(
  event: T,
): T {
  const organizationId = currentOrganizationId();
  if (organizationId !== null) {
    event.tags = { ...event.tags, organizationId: String(organizationId) };
  }
  return event;
}

/**
 * Reports an error that no Express handler will see.
 *
 * The Express integration only catches what reaches the error middleware.
 * Anything detached from a request — a queue worker, a fire-and-forget send,
 * a socket handler — has to say so itself or it is lost.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

export { Sentry };

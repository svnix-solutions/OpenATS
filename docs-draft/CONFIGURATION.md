# Configuration reference

Every environment variable OpenATS reads. Each package has its own `.env` —
there is no shared root file.

Required backend variables are validated at startup by
`backend/src/config/env.ts`: a missing one stops the process with a message
naming it, rather than crashing later on the first request that needed it.
Optional variables are not validated, so a typo in one is silent.

---

## `backend/.env`

### Required

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Postgres, as the least-privileged `openats_app` role. **Not the owner** — see below. |
| `OIDC_JWKS_URL` | Where to fetch the keys that verify access tokens |
| `OIDC_ISSUER` | Expected `iss` claim; a token from anywhere else is refused |
| `ENCRYPTION_KEY` | Base64 AES-256 key (32 bytes decoded). Encrypts stored integration credentials and signs OAuth state |
| `FRONTEND_URL` | CORS origin, Socket.IO origin, and the base for links in outbound email |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Cloudflare R2 or any S3-compatible store, for CVs and uploads |
| `SMTP_HOST` | Send over SMTP instead of Resend. Unset in production; set to `localhost` with `docker compose up -d mailpit` to read outgoing mail at http://localhost:8025 |
| `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | Only when `SMTP_HOST` points at something other than the local catcher |
| `RESEND_API_KEY` | Transactional email |
| `RESEND_FROM_EMAIL` | The address mail is sent *from*. Must be on a domain verified in Resend — the sandbox sender `onboarding@resend.dev` delivers only to the Resend account owner and drops everything else silently. Replies do not come here; they go to the agency's own address |
| `GEMINI_API_KEY` | CV parsing, scoring and summaries |

### Optional

| Variable | Default | What it is |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` | The CV analysis job queue |
| `PORT` | `8080` | HTTP and Socket.IO both |
| `MIGRATION_DATABASE_URL` | falls back to `DATABASE_URL` | Read only by drizzle-kit. Should be the **owner** role |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |
| `SENTRY_DSN` | *(off)* | Error tracking. Without it no client starts and nothing is sent |
| `SENTRY_RELEASE` | *(none)* | Ties an error to the commit that shipped it. The deploy sets this |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` | Performance tracing. `0.1` samples one request in ten |
| `RATE_LIMIT_API` | see source | Requests per window on `/api`, keyed by user id rather than IP so one office behind a NAT does not share a budget |
| `RATE_LIMIT_EXPENSIVE` | see source | The tighter limit on uploads |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID` | *(off)* | Interview scheduling via a service account |
| `GOOGLE_CALENDAR_ALLOW_ATTENDEES` | *(off)* | Service accounts cannot invite attendees without domain-wide delegation |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | *(off)* | Google Meet, connected per user from Settings → Integrations |
| `SEED_ORGANIZATION_ID` | *(none)* | Only read by the seed script, and only when more than one organization exists — it refuses to guess |
| `NODE_ENV` | — | `production` switches logs to JSON |

### The two database roles

`DATABASE_URL` must **not** be the database owner.

Postgres lets superusers and table owners bypass row-level security. An
application connected as the owner ignores every tenancy policy silently: every
query works, every isolation test passes, and nothing is filtered. Pointing
this at the owner turns multi-tenancy off without any signal that it happened.

`MIGRATION_DATABASE_URL` is the owner, and drizzle-kit is the only thing that
reads it.

---

## `frontend/.env`

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_AUTHORIZER_URL` | The identity provider's base URL, in the browser |
| `NEXT_PUBLIC_AUTHORIZER_CLIENT_ID` | The sign-in application's client id |
| `AUTHORIZER_ADMIN_SECRET` | Server-side only. Grants full directory access, so it must never be prefixed `NEXT_PUBLIC_` |
| `OPENATS_API_URL` | Where the backend is reachable **from the server** |
| `NEXT_PUBLIC_API_URL` | Where the backend is reachable **from the browser** |
| `NEXT_PUBLIC_APP_URL` | Where this app is reachable, used to show the public careers-page URL |
| `NEXT_PUBLIC_DEMO_USERNAME`, `NEXT_PUBLIC_DEMO_PASSWORD` | Optional, demo deployments only. Set both to show a credentials panel on the login page; the values are visible to every visitor |

`scripts/identity-up.sh` (via `make identity`) prints all of these. See
[IDENTITY_PROVIDERS.md](./IDENTITY_PROVIDERS.md).

---

## Roles come from the database, not the token

A user's role is read from `organization_members.role`. The token's role seeds
that row on first sign-in and is ignored afterwards.

So changing someone's role is a database change and takes effect on their next
request — it does not need an identity-provider round trip, and removing a
privilege does not wait for their token to expire.

---

## `backend/.env.test`

Committed on purpose. It holds no secrets, only dummy values, so that tests
pass on pull requests from forks — GitHub never gives secrets to those.

It points at a **separate Postgres on port 5433**, never the development
database on 5432, and `backend/tests/setup.ts` loads it with `override: true`
to make sure of it.

---

## Deploying with these

`komodo/.env.example` is this table as a file: the same variables, arranged as
a deployment supplies them rather than as a developer sets them. See
[DEPLOY_KOMODO.md](./DEPLOY_KOMODO.md).

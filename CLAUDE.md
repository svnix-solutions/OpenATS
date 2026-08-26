# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenATS is a self-hosted applicant tracking system. It is a **pnpm workspace**: `backend/` and `frontend/` are separate packages sharing one root `package.json` and one root `pnpm-lock.yaml`. Run `pnpm install` once at the root, and use the root scripts (`pnpm dev`, `pnpm build`, `pnpm test`) or `pnpm --filter ./backend <script>` to target one package.

## Commands

### Backend (`backend/`)

```bash
pnpm dev              # nodemon + tsx, port 8080
pnpm build            # tsc → dist/
pnpm start            # node dist/src/server.js
pnpm test             # vitest (watch mode)
pnpm test:run         # vitest (single run)
pnpm vitest run tests/unit/object.util.test.ts                 # run one test file
pnpm drizzle-kit generate   # generate migration SQL (always commit output)
pnpm drizzle-kit migrate    # apply migrations to DB
pnpm tsx src/db/seed.ts     # seed pipeline stages (required on first setup)
docker compose up -d        # local Postgres (5432) + Redis (6379), see docker-compose.yml at the repo root
```

### Frontend (`frontend/`)

```bash
pnpm dev      # next dev --turbo, port 3000
pnpm build    # next build
pnpm lint     # eslint
```

## Architecture

### Backend

- **Express 5** (not 4) with TypeScript compiled to CommonJS (`"module": "commonjs"` in tsconfig). `tsx` handles dev transpilation.
- **Feature-first layout**: code is organized by feature under `backend/src/modules/<feature>/`, each holding that feature's `*.controller.ts`, `*.service.ts`, and `*.routes.ts` together (e.g. `modules/candidate/candidate.controller.ts`). There are no top-level `controllers/`, `services/`, or per-feature `routes/` directories — put new feature code in its module, not in a layer folder.
- **Request flow**: `backend/src/server.ts` → `backend/src/app.ts` → `backend/src/routes/index.ts` → each module's routes file → that module's controller → service.
- **Shared code**: `backend/src/shared/auth/verify-token.ts` is the single OIDC JWT verification path, used by both `auth.middleware.ts` and the Socket.IO handshake so the two transports cannot drift on who counts as authenticated; `backend/src/shared/services/` holds services used by 2+ modules (`mail`, `socket`, `r2`, `google-calendar`); `backend/src/shared/integrations/` holds external-provider infra (`connection.service`, `registry`, `crypto`, `google-meet.provider`) — distinct from the `modules/integrations/` feature, which is CRUD for a company's configured integrations. Cross-module imports (e.g. `offer` → `../template/template-engine.service`) are fine; only promote to `shared/` when 2+ unrelated modules need it.
- `backend/src/routes/` keeps only `index.ts` (mounts every module router) and `public.routes.ts` (cross-cutting `/public/*` aggregator that spans several modules). `modules/job/job.routes.ts` also mounts the `pipeline`, `hiring-team`, and `custom-question` modules as sub-routes under `/jobs`.
- Imports are plain relative paths (no `@/` alias — `module: commonjs` + `moduleResolution: node` would emit unresolvable `require("@/…")` into `dist/`). Depth stays at `../../` at most.
- **Auth middleware** (`backend/src/middlewares/auth.middleware.ts`): verifies OIDC access tokens against a JWKS endpoint, auto-provisions users on first login, resolves the organization, and runs the rest of the request inside it. **The role comes from `organization_members.role`, not the token.** The token's role seeds that column on first attach and is ignored afterwards, so an administrator can change someone's role without an identity-provider round-trip and removing a privilege takes effect on the next request rather than when the token expires. `org_role` and the `AppRole` union hold the same five values on purpose — they were two vocabularies over one concept, and keeping them identical is what stops them drifting.
- **Public routes** (`/public/*`) use origin-based access control, not auth middleware. Each one also passes through `withPublicOrganization`, which resolves the tenant from the resource being addressed — an unresolvable identifier is a 404, since "no such job" and "a job belonging to nobody" must look the same from outside. Assessment endpoints (`/public/assessment/:token`) use token-based auth.
- **Rate limiting**: `/public/*` has its own IP-keyed limiters in `public.routes.ts`. The authenticated API is limited by `middlewares/rate-limit.middleware.ts`, keyed by **user id** rather than IP so one office behind a NAT does not share a budget — `apiLimiter` is mounted on all of `/api`, and `expensiveLimiter` on uploads. Both are tunable with `RATE_LIMIT_API` / `RATE_LIMIT_EXPENSIVE`.
- **Per-job authorization**: `middlewares/job-access.middleware.ts` (`requireJobAccess`, `requireCandidateAccess`) gates HTTP routes on hiring-team membership using the same `shared/auth/job-access.ts` rule as the sockets. Job creation adds the creator to the hiring team, and `job.service.getAll` already filters by it, so membership is the app-wide notion of "your jobs".
- **`req.user`** is available via augmentation in `backend/src/types/express.d.ts`.
- **Socket.IO** runs on the same HTTP server. Connections require a valid provider JWT in `handshake.auth.token`, verified by an `io.use()` middleware before any handler runs; the verified user is on `socket.data.user`. Chat handlers take the sender from that user, never from the client payload. Dashboard-wide events go to a **per-organization** staff room, `staff:<orgId>`, resolved from the request context at emit time. A single global `staff` room that every authenticated socket joined read as the safe alternative to `io.emit()` and was the same thing across tenants — every organization received every other one's `candidate_applied`, `offer_changed` and the rest, ids included. With no context the event is dropped rather than widened. CORS is restricted to `FRONTEND_URL`.
- **Socket authorization** is separate from authentication: `join_job` / `join_candidate` are gated by `shared/auth/job-access.ts` (hiring-team membership, with `super_admin` exempt), and the chat write handlers require the socket to already be in that room — so a client cannot skip the join and write to an arbitrary job. Client sockets are created by `frontend/lib/socket.ts`, which re-fetches a token from `/api/socket-token` on every connect attempt so reconnects survive token expiry.
- Logger is winston with console transport only (file transports commented out).
- `exactOptionalPropertyTypes: false` in tsconfig — deliberate.
- **Redis + BullMQ**: CV analysis runs as a background job queue, colocated under `backend/src/queues/cv-analysis/` (`queue.ts`, `worker.ts`, `events.ts`); shared Redis connection factory is `backend/src/config/redis.ts`. Connection is read from `REDIS_URL` (defaults to `redis://localhost:6379`). A dedicated connection is created per Queue/Worker (BullMQ best practice), not a shared singleton.

### Tenancy (read this before writing any query)

OpenATS is multi-tenant. A **row-level security policy on every table** filters
by the organization the current connection is acting for, so a query written
without thinking about tenancy is not wrong — it simply returns nothing.

- `organizations` is the tenant, one per recruiting agency. `client_companies`
  are the companies an agency recruits for; `organization_members` places a
  user in an organization, and carries `client_company_id` for client contacts.
  `PUT /api/users/:id/membership` is what sets both it and the role; a client
  role without a company is refused there and at login, rather than falling
  through to an unscoped view. **Changing a role in the provider alone does
  nothing** — the token seeds `organization_members.role` at first sign-in and
  is ignored afterwards, so that endpoint is the only thing that changes what
  a person can do.
- Every other table has `organization_id NOT NULL DEFAULT app_current_org()`.
  **Existing INSERT statements need no change** — the column fills itself from
  the connection. Existing SELECTs need no change either — the policy filters
  them. That is why the tenancy migration touched no service query.
- `app_current_org()` reads `app.org_id` off the session. It is `NULLIF`-guarded
  because `current_setting(..., true)` returns `''`, not `NULL`, once the
  setting has been used in a session, and `''::int` raises.

**Establishing the context.** The `AsyncLocalStorage` itself lives in
`db/org-context.ts`, which imports nothing but Node — `db/index.ts` imports the
logger, so anything the logger needs to read (it stamps every line with the
organization) cannot live in `db/index.ts`. `currentOrganizationId` is
re-exported from `db/index.ts`, so existing imports are unaffected.

`runInOrganization(orgId, fn)` in
`db/index.ts` checks out a connection, sets `app.org_id` on it, and puts it in
`AsyncLocalStorage`. The exported `db` is a proxy that resolves to that
connection, so services keep importing `db` and never thread anything through.
Outside a context `db` is the bare pool, where every policy sees a null
organization: **reads return nothing and writes are refused.** It fails closed.

It is deliberately *not* a transaction around the whole request — a request
writes its response from inside the callback, so a wrapping transaction would
commit only after the response had been flushed, and the client would see a 200
for uncommitted work. Use `db.transaction` where you actually want atomicity.

Six entry points establish the context, and they are the six places a new one
could be forgotten — the OAuth callback is on this list because it *was*
forgotten, and the connection it writes was silently refused for it:

| Path | Establishes it via |
| --- | --- |
| Authenticated HTTP | `auth.middleware.ts`, from the user's membership |
| Public HTTP | `withPublicOrganization(kind, param)`, from the resource in the URL |
| Socket.IO | the `inOrg` wrapper in `socket.service.ts` |
| CV analysis worker | `organizationId` carried on the BullMQ job |
| Google OAuth callback | `organizationId` carried in the signed `state` |
| CV analysis broadcast | `organizationId` carried on the Redis pub/sub event |

**In-memory state is outside the boundary.** Row-level security scopes rows,
not the process. Anything cached, memoised or broadcast in Node is shared by
every tenant unless its key says otherwise — a `Map` keyed on the literal
string `"all"` served one organization's departments to all of them for five
minutes, and a single global socket room did the same for dashboard events.
`currentOrganizationId()` belongs in any such key, and a cache that cannot
justify process-global mutable state is better deleted than parameterised.

**The deliberate holes.** Seven `SECURITY DEFINER` functions run outside the
boundary because they answer "which tenant is this" before one is known:
`app_provision_user`, `app_resolve_membership`,
`app_attach_membership_by_provider_org`, `app_attach_default_membership`,
`app_resolve_org_by_client_slug`, and `app_resolve_public_org`. Each takes an
identifier and returns ids — never a row of tenant data, which is the rule that
keeps them from becoming a way around the boundary. `EXECUTE` is revoked from
`PUBLIC` on all seven; only the owner and `openats_app` may call them.

The seventh, `app_allowed_origins`, is the exception to the shape and worth
understanding before it is copied. CORS answers before routing, so it cannot
know the tenant and an `Origin` header does not name one; through the policy
the lookup returned nothing and every configured origin was refused. It returns
origins and nothing else — never which organization configured them — and CORS
is not the authorization boundary anyway. It must never gain a way to ask
"which organization owns this origin". See `drizzle/0044`.

**Origin checks on `/public/*` are a different thing** and must stay
policy-filtered: `checkOrigins` is mounted *after* `withPublicOrganization` on
every route so it reads that organization's own list. Mounted before it, it
sees an empty list, treats that as "not configured", and waves everything
through — which is how it was, silently, until an audit went looking.

Do not add an eighth without a good reason.

The count was wrong here until an audit checked the catalog rather than this
file: two were added without updating it. `psql -c "\df app_*"` is the
authority, not this list.

**Two database roles.** Migrations run as the owner via
`MIGRATION_DATABASE_URL`; everything else runs as `openats_app` via
`DATABASE_URL`. This is not cosmetic: Postgres lets superusers and table owners
bypass RLS, so an app connecting as the owner would ignore every policy
silently and every isolation test would pass without testing anything.

**Which organization a user belongs to** comes from the `org_id` claim on the
provider token. A token naming an organization with no
`organizations` row is refused. Installs without sub-organizations fall back to
"the only organization that exists", and refuse when that is ambiguous.

The reasoning behind all of this is in `docs-draft/decisions/`.

### Two hazards when changing the schema

**Never let the snapshot learn about row-level security.** The Drizzle schema
deliberately does not declare policies — every one of them lives in a
hand-written migration, and `drizzle/meta/*_snapshot.json` records
`isRLSEnabled: false` for all 37 tables. That mismatch is load-bearing, because
it is what stops drizzle-kit having an opinion.

If the snapshot ever records RLS as *enabled* — most easily by running
`drizzle-kit pull` into `drizzle/`, but also by declaring policies in TypeScript
— the next `generate` emits `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` for
every table. Applying that silently removes the entire tenancy boundary and
every isolation test still passes, because the tests set an organization and the
queries keep working; they just stop being filtered.

Verified, not theorised: a pulled snapshot produced exactly that migration, 30-plus
statements long. **Read any generated migration for `DISABLE ROW LEVEL SECURITY`
before applying it.**

**Some migrations must be hand-written.** `candidate_stage_history`,
`candidate_custom_answers`, `candidate_custom_answer_selections`,
`candidate_assessment_attempts`, `candidate_chat_messages` and `candidates`
were changed by hand-written SQL, so the snapshot does not match them.
`drizzle-kit generate` asks an interactive question about the
`candidate_id → application_id` moves and cannot run unattended.

Use `drizzle-kit generate --custom` and write the SQL, or answer the prompt in a
real terminal with **"create column"**. Repairing the snapshot to end this is
harder than it looks — splicing a pulled one in produces migrations that drop
live constraints, because the names it reads from the database differ from the
ones drizzle derives from TypeScript.

### Candidates are people; applications are submissions

`candidates` is a person, once per organization. `applications` is one person's
submission to one job, and carries `status` and `current_stage_id`.

**`:id` on every candidate route is an application id.** That is what the
dashboard lists and links to, and what `canReadCandidate` and the socket rooms
authorise. Ids are opaque to the frontend, so nothing in the UI says so.

The two share a number space, which has produced five bugs — an id from one
side is a valid, silently wrong id on the other. Which side a column takes:

| Holds an application id | Holds a person id |
| --- | --- |
| `candidate_stage_history`, `candidate_custom_answers`, `candidate_custom_answer_selections`, `candidate_assessment_attempts`, `candidate_chat_messages` | `offers`, `candidate_interviews`, `candidate_cv_analysis`, `candidate_rejections`, `candidate_activities`, `email_messages` |

The right-hand tables all carry `job_id` too, which is what identifies the
submission — that is why they did not need repointing.

When a parameter carries an application id, call it `applicationId`. The one
place that still said `candidateId` was an offer being written against the
wrong person, and renaming it is what surfaced that.

### Database

- PostgreSQL via **Drizzle ORM**. Schema files live in `backend/src/db/schema/` (one file per domain + `relations.ts`).
- DB connection: `backend/src/db/index.ts` — pg Pool with Neon scale-to-zero handling. It also exports `runInOrganization`, the `db` proxy, `currentOrganizationId()`, and `unscopedDb` (which bypasses the proxy and is for migrations, seeding and tests only — it is still subject to RLS).
- When changing the schema: run `pnpm drizzle-kit generate` in `backend/`, then **commit the generated `drizzle/*.sql` files**.
- The seed (`backend/src/db/seed.ts`) creates 5 default pipeline stages (Applied, Screening, Interviewed, Offer, Rejected) - required for the app to function.
- **Local Postgres + Redis**: `docker-compose.yml` at the repo root runs both as containers (`openats`/`openats`/`openats` for user/password/db on Postgres; Redis with no auth). Not required — Neon/hosted Redis work too — but this is the fastest path for local dev. See `CONTRIBUTING.md` for the full setup flow.

### Frontend

- **Next.js** with `force-dynamic` on the root layout (`frontend/app/layout.tsx`) — the entire app is SSR-disabled because the auth provider requires request context.
- Heavy components are code-split with `ssr: false` via `frontend/components/dynamic-imports.tsx`.
- **Tailwind v4** — CSS-first config (`@tailwindcss/postcss`), no `tailwind.config.ts`. Theme defined via `@theme` in CSS globals.
- **shadcn/ui** with `base-vega` style. Icon library is **hugeicons** (not lucide or heroicons).
- Path alias: `@/*` → `./*` (configured in both `tsconfig.json` and Next.js config).
- **Server-side data fetching**: `serverFetch` in `frontend/lib/auth-action.ts` using `React.cache()` for auth context.
- **Client-side data fetching**: `useApi` hook + React Query hooks in `frontend/hooks/queries/`.
- **Component placement convention**: components/hooks/utils scoped to one route live colocated under that route using Next.js's underscore-prefixed folders (excluded from routing) — `_components/` (nest further for large features, e.g. `templates/_components/template-form/email-builder/`), `lib/` (singular — not `libs/`), `hooks/`. Only truly shared code goes in the top-level `frontend/components/` (shadcn primitives in `components/ui`, shared `components/table`), `frontend/lib/`, and `frontend/hooks/queries/`.

## Testing

See `docs-draft/TESTING.md` for the full guide. In short:

- **Unit + integration tests** use Vitest and live in `backend/tests/` (`unit/`, `integration/`), excluded from `tsconfig.json` compilation. Config is `backend/vitest.config.mts` (`.mts` because the backend is a CommonJS package).
- **End-to-end tests** use Playwright and live in `e2e/` at the repo root, because they span both packages. Config is `playwright.config.ts`, and `tsconfig.json` at the root covers them.
- **Tests run inside an organization.** `tests/helpers/scenario.ts` builds one coherent world and exposes `itInOrg`, which is `it` with the body wrapped in `runInOrganization`. A test that skips it sees an empty database rather than an error. `tests/integration/rls-coverage.test.ts` reads the catalog and fails if any table is missing RLS, a policy, or the session default — so a new table cannot quietly escape the boundary.
- **Integration tests hit a real database**: a separate Postgres on port **5433** (`postgres-test` in `docker-compose.yml`), never the dev database on 5432. `backend/tests/setup.ts` loads `backend/.env.test` with `override: true` to enforce this.
- `backend/.env.test` is committed on purpose. It holds no secrets, only dummy values, so that tests pass on pull requests from forks (GitHub never gives secrets to those).
- E2E tests also use the 5433 database, via `webServer.env` in `playwright.config.ts`. `reuseExistingServer` is `false` so an already-running `make dev` cannot be adopted, which would silently point tests at the dev database. **Stop `make dev` before running E2E.**
- Commands: `pnpm test` (backend then frontend unit tests), `pnpm test:frontend`, `pnpm test:coverage` (v8 coverage on the backend), `pnpm test:e2e` (Playwright), `pnpm exec tsc --noEmit` (type-check the E2E specs, which Playwright does not do).
- CI runs tests, type-check, and the backend build on every pull request (`.github/workflows/test.yml`). It deliberately uses no secrets.
- **Frontend tests** use a separate Vitest install in `frontend/` with jsdom and Testing Library, in `frontend/tests/`. They cover pure helpers and rendered components; there is no network or router mocking set up yet.

## Roadmap

`docs-draft/GA_ROADMAP.md` tracks everything remaining before v1.0, grouped by release, with a status on every item (🔴 Planned, 🟡 In progress, 🟢 Done).

**When you complete work that appears on that roadmap, update the item's status in the same change.** If you finish something that is not listed, add a row for it. An out-of-date roadmap is worse than none, because it states things that are not true.

## Environment Variables

Two separate `.env` files are required (copy from `.env.example` in each directory):

- `backend/.env` — `DATABASE_URL` (the least-privileged `openats_app` role), `MIGRATION_DATABASE_URL` (the owner, read only by drizzle-kit), `REDIS_URL`, `R2_*`, `RESEND_*`, `OIDC_JWKS_URL`, `OIDC_ISSUER`, `GEMINI_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`, and optionally `SENTRY_DSN` (error tracking is off without it, which is what development and CI want) and `LOG_LEVEL`
- `frontend/.env` — `NEXT_PUBLIC_AUTHORIZER_URL`, `NEXT_PUBLIC_AUTHORIZER_CLIENT_ID`, `AUTHORIZER_ADMIN_SECRET`, `OPENATS_API_URL`, `NEXT_PUBLIC_API_URL`

## CI/CD

- ⚠️ The deploy workflow currently fails on this fork with `missing server host`: `SSH_HOST` and friends are repository secrets, and GitHub does not copy secrets to forks. Nothing is being deployed from here.
- `.github/workflows/deploy.yml` deploys the **backend only** to an Azure VM on push to `main` (when `backend/**` changes): SSH → git reset → pnpm install → unpack the `dist` built by CI → migrate → pm2 restart. **The VM does not compile.** `test.yml` builds `backend/dist`, tars it and uploads it as the `backend-dist` artifact; the deploy job downloads that exact tarball. Compiling on the VM produced the artifact from whatever toolchain that box happened to have, which is how it drifted from what CI had tested.
- CI runs lint for both packages, migrations, unit and integration tests, two type-check passes, and a build of both packages on every pull request (`.github/workflows/test.yml`). The frontend build is not redundant with lint: Next resolves routes at build time, so ambiguous dynamic segments and invalid page signatures surface only there. It creates the `openats_app` role before migrating, because service containers start before checkout and cannot mount the init script.
- Both packages have ESLint, and both are linted in CI.

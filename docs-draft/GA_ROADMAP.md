# OpenATS Road to GA

This is the plan for getting OpenATS to `v1.0.0` (general availability). It tracks what is left, why each item matters, and what is already done.

Current version: **v0.5.0**

## Status legend

| Status | Meaning |
| --- | --- |
| 🔴 Planned | Not started |
| 🟡 In progress | Being worked on now |
| 🟢 Done | Shipped |

---

## v0.5.0 - Fix what is broken

The focus of this phase is correctness and safety, not new features. Nothing here adds functionality, it makes what already exists trustworthy.

### Security

| Item | Why it matters | Status |
| --- | --- | --- |
| Authenticate Socket.IO connections | Sockets currently accept **any** connection with `cors: "*"` and no auth. An anonymous client can emit `send_job_message` with any `senderId` and write to the database impersonating a user. **This is the one true GA blocker.** | 🟢 Done |
| Scope socket broadcasts to rooms | `notifyStageChanged`, `notifyOfferChanged`, and `notifyInterviewChanged` use `io.emit()` with no room, so every connected client receives candidate pipeline movements, offers, and interviews. | 🟢 Done |
| Take `senderId` from the JWT, not the payload | The client currently supplies its own user id on socket writes. | 🟢 Done |
| Authorize socket room joins | Sockets now require authentication, but any logged-in user can still `join_job` for a job they are not on the hiring team for. Authentication closed the public hole, this closes the internal one. | 🟢 Done |
| Re-check socket tokens on reconnect | The token is read once when the dashboard layout renders. If it expires while a tab is open, reconnects fail silently and realtime stops until the page is refreshed. | 🟢 Done |
| Authorize chat history over HTTP | `GET /chat/job/:jobId` and `/chat/candidate/:candidateId` return any conversation to any authenticated user. The socket rooms are now gated, so this is the remaining way to read another hiring team's chat. | 🟢 Done |
| Rate limit authenticated routes | Only `/public/*` is rate limited today. | 🟢 Done |
| Scope record reads to the hiring team | `requireJobAccess` existed but was wired to 3 of ~70 authenticated routes, so any logged-in user could read a job, offer, interview, assessment attempt, or rejection belonging to a team they are not on by requesting its id. Extends the guard to record reads and scopes the offer and interview lists. | 🟢 Done |
| Resolve dependency vulnerabilities | 54 reported (15 high). Every high comes through `next@16.1.6`, the only direct dependency involved: bumping it to `>=16.2.11` also clears the `sharp` and `postcss` copies it pins. `dompurify` arrives via `@asgardeo/react` and needs a `pnpm.overrides` entry or an upstream fix. Do this last, right before release, so the version bump is fresh. | 🔴 Planned |

### Deployment

🟢 **Complete and verified in production on 6 Aug 2026.** A deliberate change to the `/health` response string was pushed and confirmed live at `api.openats.dev`, proving the VM now receives new code. Before this, deploys had been silently failing since at least 3 Aug 2026 while reporting success.

| Item | Why it matters | Status |
| --- | --- | --- |
| Add `set -e` to the deploy script | Without it, failed steps still report success because only the last command sets the exit code. Deploys have been silently failing since at least 3 Aug 2026. | 🟢 Done |
| Use `git reset --hard origin/main` | The VM has drifted (locally modified `pnpm-workspace.yaml`, stray `pnpm-lock.yaml`), which makes `git pull` abort. A hard reset removes drift permanently. | 🟢 Done |
| Install from the repo root, not `backend/` | The deploy still installs from `backend/`, which is wrong since the pnpm workspace conversion. | 🟢 Done |
| Health check after restart | `curl -fsS http://localhost:8080/health` at the end, so a crash-looping process does not report a green deploy. | 🟢 Done |
| Gate deploy on tests passing | `test.yml` and `deploy.yml` are independent, so a red build still deploys. | 🟢 Done |

### Testing

| Item | Why it matters | Status |
| --- | --- | --- |
| Tests for authentication | Login broke completely in v0.4.0 and nothing would have caught it. 17 tests in `tests/integration/auth.test.ts` now cover token validity, claims, provisioning, and the middleware. Only the JWKS fetch is mocked, so signature/issuer/expiry are genuinely verified. Confirmed to bite by reintroducing the v0.4.0 `sub`-change bug and watching only that test fail. | 🟢 Done |
| Tests for core flows | Apply to a job, move pipeline stage, send an offer, schedule an interview. 11 tests in `tests/integration/core-flows.test.ts` drive the real HTTP API end to end with a signed token. Writing them found a live bug: a partial `PATCH /offers/:id` wiped `startDate`, leaving the offer unsendable. Fixed, with a regression test. | 🟢 Done |
| Frontend tests | None existed. Vitest + Testing Library + jsdom are set up in `frontend/`, with 24 tests covering `buildJobPayload`, the offer formatting helpers, and one rendered component to prove the React half works. | 🟢 Done |
| Coverage reporting | Without it, "how much is tested" is guesswork. `pnpm test:coverage` runs v8 coverage on the backend (text, html, lcov). Baseline is 20% statements overall, 94% on `shared/auth`. | 🟢 Done |
| Type-check tests in CI | `tsconfig.test.json` inherited `"exclude": ["tests"]` from the base config, so it checked nothing; a deliberate type error sat in `object.util.test.ts` and passed. Config fixed and `test.yml` now runs it as its own step, verified with a canary error. | 🟢 Done |

### Tooling

| Item | Why it matters | Status |
| --- | --- | --- |
| Add linting to the backend | There is no ESLint config or script, and `pnpm lint` at the repo root currently **fails** with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. Now configured, passing with 0 problems, and gated in CI. | 🟢 Done |
| Call `validateEnv()` in `worker.ts` | The API validates its environment on boot, the worker does not, so it can start with broken config and fail later at job time. | 🟢 Done |
| Fix the frontend's lint errors | 112 errors, of which 91 were `no-explicit-any` (not `set-state-in-effect` as first recorded). All are now fixed and root `pnpm lint` exits 0, so lint can become a CI gate. Two `react-hooks/set-state-in-effect` cases carry a scoped `eslint-disable` with the reason in a comment: both mutate state (a pending-moves map, a module-level id counter) that cannot legally move into render. 35 warnings remain, mostly unused vars. | 🟢 Done |
| Remove `any` from the backend | 108 uses, mostly `catch (e: any)` and `(e as any).message`. All replaced with narrowed helpers, so `no-explicit-any` is an **error** and the backend has none. | 🟢 Done |
| Add `CHANGELOG.md` | Release notes only existed on GitHub. All five releases are now reproduced in the repo in Keep a Changelog format, with an `[Unreleased]` section tracking the v0.5.0 work. | 🟢 Done |

---

## v1.0.0 - General availability

The "do it properly" phase. None of this is urgent, all of it is what separates a working project from one people rely on.

| Item | Why it matters | Status |
| --- | --- | --- |
| Build artifacts in CI | Compiling TypeScript on the production VM is how the current drift happened. Build once in CI, ship the result. | 🔴 Planned |
| Rollback mechanism | There is no way back from a bad deploy except another deploy. | 🔴 Planned |
| Staging environment | Every change currently goes straight to production. | 🔴 Planned |
| Error tracking | Console-only logging means a user-reported error cannot be investigated. | 🔴 Planned |
| Structured logging | One JSON object per line when `NODE_ENV=production`, readable otherwise; errors keep their stack in a named field. Console only — pm2 already writes and rotates stdout. | 🟢 Done |
| Security review | Before telling anyone to run this with real candidate data. | 🔴 Planned |
| Complete documentation | Deployment guide, configuration reference, upgrade guide. | 🔴 Planned |

---

## Beyond GA

Not part of the road to v1.0, but decided and written down so it is not invisible.

| Item | Where | Status |
| --- | --- | --- |
| Multi-tenancy: agencies, client companies, and applications | [decisions/0001-multi-tenancy.md](decisions/0001-multi-tenancy.md) | 🟡 In progress |

| Item | Where | Status |
| --- | --- | --- |
| Tenancy schema: organizations, client companies, memberships | [0001 §2](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Row-level security on every table, forced, with WITH CHECK | [0001 §3](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Least-privileged database role, so policies actually apply | [0002 §2](decisions/0002-testing-multi-tenancy.md) | 🟢 Done |
| Request, socket, worker and public-route contexts | [0002 §2](decisions/0002-testing-multi-tenancy.md) | 🟢 Done |
| Characterization tests for the services phase 1 rewrites | [0002 §2](decisions/0002-testing-multi-tenancy.md) | 🟢 Done |
| Generated isolation sweep over the catalog | [0002 §2](decisions/0002-testing-multi-tenancy.md) | 🟢 Done |
| Organization resolved from the Asgardeo `org_id` claim | [0001 §5](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Sub-organization provisioning in `setup-asgardeo.sh` | [0001 §5](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Jobs belong to a client company | [0001 §7](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Split candidates into a person and an application | [0003](decisions/0003-application-split-is-separable.md) | 🟢 Done |
| Role read from `organization_members`, not the JWT | [0001 §6](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Client portal: roles and company scoping | [0001 §6](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Client portal: redaction of the agency's working view | [0001 §6](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Client portal: the client-facing UI | [0001 §6](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Per-client careers pages | [0001 §7](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Per-agency email branding | [0001 §7](decisions/0001-multi-tenancy.md) | 🟢 Done |
| Per-agency sending domains in Resend | [0001 §7](decisions/0001-multi-tenancy.md) | 🔴 Planned |
| `Reply-To` on outgoing email, and `RESEND_FROM_EMAIL` guidance | Parked deliberately until the product is built and tested | 🔴 Planned |

**Email sending is deliberately parked.** Nothing sets `Reply-To`, so a
candidate who replies writes to `RESEND_FROM_EMAIL` — which defaults to
`onboarding@resend.dev`, Resend's sandbox sender, and only delivers to the
account owner's own verified address. On a fresh deploy that means candidate
replies go nowhere. The fix is small (`company.email` is already
organization-scoped, so no migration) and is held until the product is built
and tested, not forgotten. A single shared sending domain is otherwise fine:
SPF/DKIM/DMARC all align on a domain you control, and per-agency domains are
worse until each agency completes its DNS setup. The argument for splitting
them is pooled reputation between tenants, which only bites at volume.

Phase 0 (closing the per-job authorization gaps on read routes) is done, and it overlapped the **Security review** item above — that review is now better spent on the tenancy boundary than on the single-tenant model it replaced.

Two things still answer "which organization" by assuming there is only one, and refuse rather than guess when there is not: public routes that address no particular resource, and seeding. Both are answered properly by the client company in the URL, so they clear when jobs belong to a client company.

---

## Completed

### v0.4.0 (5 Aug 2026)

| Item | Status |
| --- | --- |
| Backend reorganized into feature modules (`src/modules/`, `src/shared/`) | 🟢 Done |
| Fixed login failing when the Asgardeo `sub` changes | 🟢 Done |
| Fixed the logger silently dropping error details at 41 call sites | 🟢 Done |
| Fixed the backend not compiling (duplicate `ioredis` versions) | 🟢 Done |
| Vitest set up for unit and integration tests | 🟢 Done |
| Playwright set up for end-to-end tests | 🟢 Done |
| Isolated test database on port 5433 | 🟢 Done |
| CI running tests, type check, and build on every pull request | 🟢 Done |
| Testing guide (`docs/TESTING.md`) | 🟢 Done |
| Restored 91 accidentally deleted lines in `CONTRIBUTING.md` | 🟢 Done |

---

## Keeping this file current

When you finish something on this list, update its status in the same pull request as the work. A roadmap that is not updated is worse than no roadmap, because it tells people things that are not true.

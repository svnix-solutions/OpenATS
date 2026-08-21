# 0002 — Testing the tenancy boundary

| | |
| --- | --- |
| **Status** | Proposed |
| **Date** | 21 August 2026 |
| **Refines** | [0001 — Multi-tenancy](0001-multi-tenancy.md), section 3 |

[0001](0001-multi-tenancy.md) argues for enforcing tenant isolation with Postgres row-level security, and closes section 3 with a single line about testing it: *"add one test per table asserting that a read under organization A's context returns none of organization B's rows. That is 33 cheap tests."*

That line is wrong in one place and dangerously incomplete in another. This record replaces it.

---

## 1. Context

### The test database cannot test RLS

Run against the real test container, with RLS enabled on a probe table and a policy scoping rows to organization 100:

| Connected as | Rows returned |
| --- | --- |
| `openats` — the role `backend/.env.test` uses | **both** organizations' rows; the policy is inert |
| `openats` with `FORCE ROW LEVEL SECURITY` | **still both** |
| a non-superuser role | only organization 100's row |
| a non-superuser role, no context set | **zero rows** |

The `postgres` image makes `POSTGRES_USER` a superuser, and migrations then make that same role the owner of every table. Superusers bypass RLS unconditionally and owners bypass it unless forced, so `openats` bypasses twice over.

Two consequences, and the first is the serious one:

- Every isolation test written against the current setup **passes without testing anything**. The suite would go green on a boundary that does not exist. A test that cannot fail is worse than no test, because it is read as evidence.
- `FORCE ROW LEVEL SECURITY` does not rescue this. It changes owner behaviour, not superuser behaviour. Only connecting as a non-superuser does.

The same `POSTGRES_USER: openats` appears in [`.github/workflows/test.yml`](../../.github/workflows/test.yml), so CI has the identical problem.

### There is no safety net for a rewrite this size

Backend coverage today:

```
All files          |   21.21 % stmts
 src/shared/auth   |   96.15
 src/modules/offer |   30.52
 src/modules/chat  |   26.31
 src/modules/user  |   15.53
 src/modules/job   |   14.10
```

Every other module — candidate, interview, assessment, assessment-execution, template, report, rejection, integrations, company, pipeline, hiring-team, custom-question, settings, upload — does not appear in the report at all, meaning no test ever loads it.

0001 phase 1 rewrites the data access layer of 24 services. Most of them have no test asserting what they currently return, so there is nothing for the rewrite to be checked against. This is a larger risk than the RLS policies themselves: a wrong policy fails closed and someone notices, while a service quietly returning a different shape does not.

### The pooled-connection leak is real, not theoretical

Also reproduced on the test container. A plain `SET app.org_id` persists for the life of the connection, so the next request served by that pooled connection inherits the previous tenant's context:

```
SET app.org_id = '200';
SELECT count(*) FROM rls_probe;   -- 1  (correct)
SELECT count(*) FROM rls_probe;   -- 1  (a "new request", still scoped to org 200)
```

This is the failure mode most likely to reach production: it is invisible under sequential testing, appears only under connection reuse, and leaks across tenants when it does.

---

## 2. Decision

Six pieces of work, in dependency order. The first two are prerequisites for phase 1 rather than part of it.

### Step 1 — Make RLS testable

The application and the tests connect as a **non-superuser** role; migrations continue to run as the owner.

- A `openats_app` role, created during environment setup, with `SELECT, INSERT, UPDATE, DELETE` on the schema's tables and `USAGE` on its sequences.
- `ALTER DEFAULT PRIVILEGES` for the migration-running role, so tables created by future migrations are granted automatically rather than each migration having to remember.
- `FORCE ROW LEVEL SECURITY` on every table, because on a managed Postgres the application role may itself be the table owner.
- A test asserting the connected role is not a superuser. This is the guard that stops the vacuous-green class of bug from coming back — without it, someone repoints `DATABASE_URL` a year from now and every isolation test silently stops testing.

Role creation is environment setup, not a migration. A migration that creates a login role needs a password committed to the repository, and one that creates it only when absent will happily manufacture a known-password superuser-adjacent account in production if someone forgets to provision it first. Grants belong in migrations; identity does not.

### Step 2 — Characterization tests, before the schema moves

Golden-output tests over the services phase 1 rewrites, ordered by blast radius: `candidate`, `job`, `offer`, `interview`, `assessment-execution`, `report`.

These are not exhaustive unit tests and are not trying to raise a coverage number. Given a fixture, this shape comes back. They exist to fail loudly when the rewrite changes behaviour, and they are worth writing even though some of them will be deleted by the candidate/application split — a test that dies telling you what changed has done its job.

### Step 3 — Generate the isolation sweep

**This is where 0001 was wrong.** One hand-written test per table does not survive contact with a growing schema: the table someone adds in six months is exactly the one nobody writes the test for, and its absence is invisible.

Instead, enumerate tables from the Drizzle schema at runtime and assert for each that it has RLS enabled, has a policy, and returns zero rows under a foreign organization's context. A table added without a policy then fails a test nobody had to remember to write.

### Step 4 — Pool-context tests

The bug class from section 1. Three tests, all of which fail against a naive implementation:

- Context is set with `SET LOCAL` inside a transaction, not a bare `SET`.
- A connection returned to the pool carries no context, so a reader that forgets to set one sees zero rows rather than whatever the last request left behind.
- Concurrent interleaved requests across different organizations each see only their own rows. Sequential tests cannot catch this; the test has to actually run them at the same time.

### Step 5 — The async paths

The BullMQ worker and the Socket.IO handlers reach `db` without passing through Express, so they get no context from middleware. One test each: they operate under the correct organization, and fail closed without one.

### Step 6 — Post-migration integrity

After the candidate/application split: no orphaned rows, every application resolves to exactly one candidate and one job, and foreign-key integrity holds across all eleven repointed tables.

---

## 3. What this does not cover

**End-to-end.** The single careers spec is adequate until phase 3. "A client user signs in and sees only their own candidates" is worth driving through a real browser, but not before the client portal exists.

**Frontend.** 24 tests over pure helpers and two components, with no network or router mocking. Phase 1 changes no frontend behaviour, so this record does not propose changing that. It will matter at phase 3.

**Coverage as a target.** 21% is evidence that specific services are untested, not an argument for reaching a number. Steps 2 to 6 will raise it as a side effect; chasing the figure directly would produce tests of the wrong things.

---

## 4. Consequences

**Phase 1 gets slower before it gets faster.** Steps 1 and 2 produce no user-visible change and must land before the schema work starts. Skipping them does not remove the work, it moves it to after the rewrite, when the tests have nothing trustworthy to compare against.

**Local setup grows a step.** Developers with an existing `postgres-data` volume will not get the new role from a container init script, since those run only on an empty data directory. This needs a `make` target and a line in `CONTRIBUTING.md`.

**Production role provisioning moves out of band.** Someone must create the application role on the production database before the first RLS migration, and `DATABASE_URL` must be repointed at it. This belongs in the deployment guide that [`GA_ROADMAP.md`](../GA_ROADMAP.md) already lists as planned.

**Two connection identities to keep straight.** Migrations run as owner, the application runs as the app role. Anything that runs raw SQL outside both paths — `db/seed.ts` today — has to pick one deliberately.

---

## 5. Alternatives considered

### Test RLS as the superuser and trust the policies by inspection

Rejected, and it is worth naming because it is what happens by default if nobody looks. The policies would be reviewed once, in the pull request that adds them, and never exercised again. Every subsequent test would report success regardless of whether isolation worked. This is the single most likely way for this project to ship a tenancy boundary that does not hold.

### Hand-write one isolation test per table, as 0001 proposed

Rejected. Correct on the day it is written and decays from there. The failure is silent: a missing test looks exactly like a passing suite.

### Skip characterization tests and rely on the type checker

Rejected. TypeScript catches the shape of a return value, not its contents. Nothing in the type system notices that a query lost a `WHERE` clause and now returns every row, which is precisely the mistake this migration invites.

### Application-level scoping instead of RLS, to avoid the role work

Already rejected in [0001 §10](0001-multi-tenancy.md), on the evidence that the per-job guard reached 3 of ~70 routes. Restated here only because step 1 is the visible cost of that decision and it will be tempting to reopen it when the role work turns awkward.

---

## 6. Open questions

- Does the seed script run as the owner or the app role? It creates data that must be visible to the app, and once tables carry `organization_id` it needs an organization to seed into.
- Should the dev database also use the app role, or only test and production? Parity argues yes; the friction of migrating existing local volumes argues no.
- Do characterization tests for services that the candidate/application split will rewrite get deleted with it, or rewritten in place? Deleting is honest; rewriting keeps the coverage.

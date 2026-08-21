# 0003 — The candidate/application split is separable from tenancy

| | |
| --- | --- |
| **Status** | Proposed |
| **Date** | 22 August 2026 |
| **Amends** | [0001 — Multi-tenancy](0001-multi-tenancy.md), section 4 |

[0001 §4](0001-multi-tenancy.md) ends by arguing that splitting `candidates` into a person and an application must happen in the same migration as the tenancy work:

> This is the change most likely to be underestimated, and it touches **the same tables** that need `organization_id`. Doing them as separate waves means rewriting every service twice against a schema that is unstable both times. They belong in one migration.

That reasoning was sound when written and is no longer true. This record separates them.

---

## 1. What changed

The premise was that adding `organization_id` would require rewriting every service, so the split should ride along rather than force a second rewrite. Building it showed the premise was wrong.

A column default can read the request's organization from the session:

```sql
organization_id int NOT NULL DEFAULT app_current_org()
```

Every existing `INSERT` keeps working untouched, because the column fills itself. Every existing `SELECT` keeps working, because the policy filters it. Across all 32 tenant-scoped tables, **no service query changed**.

So the tenancy wave did not rewrite the services once, let alone twice. The split is now the only thing that would, and there is nothing left for it to share a migration with.

## 2. Decision

Do them separately. Tenancy has landed; the split is ordinary feature work that can be scheduled on its own merits.

The cost 0001 was avoiding — writing every service twice — does not exist. The cost of bundling them does: one migration that changes the shape of `candidates`, repoints eleven foreign keys, adds a column to 32 tables and enables row-level security across 36 is not reviewable, and a problem in any part of it stalls all of it.

Tenancy alone produced five defects that only appeared when run — an unsatisfiable `users` policy, `INSERT ... RETURNING` applying the SELECT policy, three separate breaks in login. Each was cheap to find because the change around it was small enough to bisect. That is the argument for keeping the split apart, restated as evidence rather than prediction.

## 3. What does not change

Everything else in [0001 §4](0001-multi-tenancy.md) stands: the split itself, its shape, and the table-by-table decisions about which side each of the eleven repointed foreign keys belongs on. Only the sequencing claim is withdrawn.

The characterization suites added in the tenancy work already cover the services the split will rewrite, and `characterize-candidate.test.ts` was written expecting to fail during it. That safety net is in place now, which it was not when 0001 was written.

## 4. Consequences

**The split can be scheduled against product need rather than migration mechanics.** It unlocks the agency talent pool, so it belongs with phase 2 rather than phase 1.

**Two schema waves touch the same tables.** The tenancy wave already added a column to them; the split will repoint their foreign keys. That is genuinely two migrations over the same rows, which is what 0001 wanted to avoid — but the second one is now a migration nobody has to review alongside 33 unrelated `ALTER TABLE` statements.

**Ordering is no longer forced, so it must be chosen.** Sub-organizations ([0001 §5](0001-multi-tenancy.md)) are the more urgent of the two: three places currently answer "which organization" with a single-organization bridge, each refusing rather than guessing when ambiguous, and all three are standing in for that missing piece.

## 5. Alternatives considered

**Bundle them anyway, as 0001 says.** Rejected. Following a merged record because it is merged, when the fact it rested on has been disproved, is how a decision log becomes a liability. The README's answer to a superseded conclusion is a new record, which is this one.

**Amend 0001 in place.** Rejected, and for the same reason the README gives: the record describes what was decided with what was known then. The interesting part here is *why* the sequencing changed — a technique found while building — and editing 0001 would erase exactly that.

**Do the split first, then tenancy.** Moot; tenancy has landed. Worth noting it would have been the wrong order anyway: the split has no isolation properties to test, so doing it first would have meant rewriting eleven tables' foreign keys with no boundary in place to catch a mistake.

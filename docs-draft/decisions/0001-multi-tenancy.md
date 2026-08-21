# 0001 — Multi-tenancy: agencies, client companies, and applications

| | |
| --- | --- |
| **Status** | Proposed |
| **Date** | 21 August 2026 |
| **Affects** | Every table, every backend service, identity, and the public careers surface |

OpenATS today assumes one company hiring for itself. This record covers turning it into a platform that hosts many recruiting agencies, each hiring on behalf of many client companies, with people at those client companies logging in to review their own candidates.

Three inputs to this decision are already settled and are not re-argued below:

- **Agencies are the tenant.** Client companies live inside an agency, not beside it.
- **Client staff get logins.** They read and leave feedback on their own jobs, and nothing else.
- **No backwards compatibility.** Nothing is in production with real candidate data, so there is no backfill, no dual-write period, and no single-tenant mode to keep alive. This is the cheapest this change will ever be.

---

## 1. Context

There is no tenancy boundary to widen. There is not one at all.

`company` is a singleton, read with `.limit(1)` in four separate services ([`company.service.ts`](../../backend/src/modules/company/company.service.ts), [`candidate.service.ts:145`](../../backend/src/modules/candidate/candidate.service.ts), [`upload.controller.ts:28`](../../backend/src/modules/upload/upload.controller.ts), and [`page-settings.service.ts`](../../backend/src/modules/settings/page-settings.service.ts)). The `jobs` table has no `company_id`; it reaches a company only indirectly, through `department_id → departments.company_id`. Of 33 tables, exactly one — `departments` — carries a company reference. `users`, `candidates`, `templates`, `assessments`, and `offers` carry none.

Authorization today is per-job hiring-team membership, via [`shared/auth/job-access.ts`](../../backend/src/shared/auth/job-access.ts). Role comes from the Asgardeo JWT and is deliberately never stored in the database. `users.email` is globally unique.

Two facts about the current state matter to the decisions below, because they are evidence rather than opinion:

1. `requireJobAccess` exists, is tested, and is wired to **3 of roughly 70** authenticated routes. The middleware is correct; the discipline of applying it everywhere did not hold.
2. `candidates` is simultaneously a person and an application: it carries contact details alongside `job_id NOT NULL`, `current_stage_id`, and `status`, under `unique(job_id, email)`.

---

## 2. Decision

Adopt a three-level hierarchy, with the agency as the isolation boundary:

```
organization  (the agency — isolation boundary, organization_id on every table)
├── organization_members     agency staff and client contacts; role lives here
├── candidates               the person, once per agency: the talent pool
└── client_company           own branding, careers page, allowed origins
    └── job                  pipeline stages, hiring team
        └── application      one candidate × one job  ← new
```

A company that hires only for itself is an agency with exactly one client company. That keeps one code path and avoids maintaining a "single-tenant mode" beside the real one.

Three structural changes make this work, and they are described in sections 3 to 5. Sections 6 and 7 cover sequencing and cost; section 8 records what was rejected.

---

## 3. Isolation is enforced in Postgres, not in application code

**Decision:** put `organization_id` on every table, write one row-level security policy per table keyed on `current_setting('app.org_id')`, and set that value with `SET LOCAL` inside a per-request transaction.

Adding the column to 33 tables is mechanical. Guaranteeing that every query across 24 service files always filters on it is not, and this codebase has already run that experiment: the per-job guard is applied to 3 of ~70 routes. That same lapse at tenant scope is not an internal permissions bug, it is one agency reading another agency's candidates.

Row-level security changes the failure mode. A forgotten `WHERE` clause returns **zero** rows instead of every tenant's rows — wrong in a way that shows up immediately in testing, rather than silently in production.

### What this costs

Every database access has to run inside a transaction carrying the org context, so [`db/index.ts`](../../backend/src/db/index.ts) needs a request-scoped wrapper rather than a bare pool.

Two paths do not go through Express middleware and will be missed unless they are explicitly on the checklist:

| Path | Why it is easy to miss |
| --- | --- |
| The CV analysis worker ([`queues/cv-analysis/worker.ts`](../../backend/src/queues/cv-analysis/worker.ts)) | Jobs must carry `organizationId` in their payload, and the worker must set the context before any query |
| Socket.IO handlers ([`shared/services/socket.service.ts`](../../backend/src/shared/services/socket.service.ts)) | They read and write chat directly through `db`, entirely outside the HTTP stack |

### Making the guarantee real

The integration suite already runs against a real Postgres on port 5433. Add one test per table asserting that a read under organization A's context returns none of organization B's rows. That is 33 cheap tests, and they convert an architectural intention into a checked invariant.

---

## 4. A candidate is split from an application

**Decision:** `candidates` becomes the person, scoped to the agency under `unique(organization_id, email)`. A new `applications` table carries the candidate-to-job relationship, along with `current_stage_id`, `status`, `applied_at`, and `source`.

Fusing the two is a reasonable simplification for a company hiring for itself. For an agency it breaks the core asset. The same person is submitted to Acme in March and to Globex in September; today those are two unrelated rows with duplicated contact details, a duplicated CV in R2, and no shared history. An agency's talent pool is the thing it sells.

Eleven tables reference `candidate_id` today. Each needs a deliberate decision about which side of the split it belongs to:

| Table | Repoints to | Reasoning |
| --- | --- | --- |
| `candidate_stage_history` | `application_id` | Stages exist per job pipeline |
| `candidate_interviews` | `application_id` | Already carries `job_id` redundantly |
| `offers` | `application_id` | Already carries both `candidate_id` and `job_id`; the pair becomes one key |
| `candidate_assessment_attempts` | `application_id` | Assessments attach to a job stage |
| `candidate_rejections` | `application_id` | A person is rejected for a role, not in general |
| `candidate_custom_answers` | `application_id` | Custom questions are defined per job |
| `candidate_cv_analysis` | `application_id` | Scores a CV *against a job*; meaningless without one |
| `candidate_activities` | both | Split: job-scoped events vs. notes about the person |
| `candidate_chat_messages` | both | Client-visible discussion is per application; agency notes on the person are not |
| `email_messages` | `candidate_id` | Correspondence follows the person across roles |

This is the change most likely to be underestimated, and it touches **the same tables** that need `organization_id`. Doing them as separate waves means rewriting every service twice against a schema that is unstable both times. They belong in one migration.

---

## 5. Identity becomes org-scoped

**Decision:** an agency is an Asgardeo **sub-organization**. Within it, an `organization_members` table carries the role and — for client contacts — the single `client_company_id` they are confined to.

[`verifyAccessToken`](../../backend/src/shared/auth/verify-token.ts) currently reads `roles` from the JWT, maps it to one of three app roles, and just-in-time provisions any user presenting a mapped role. Three things break at once at multi-tenant scale:

- The same person cannot exist at two agencies, because `users.email` is globally unique. A consultant who is a client contact for two of them cannot exist at all.
- A `Hiring Manager` claim means nothing without knowing *which organization* it applies to.
- `canAccessJob` returns `true` unconditionally for `super_admin`. With an org-unaware role claim, that is a cross-tenant read of everything.

The sub-organization gives a hard identity boundary and an `org_id` claim that can be trusted. Note that [`setup-asgardeo.sh:26`](../../setup-asgardeo.sh) already records that it configures the root organization and that the `/o/`-prefixed B2B endpoints are deliberately unused — that script becomes the provisioning path for new agencies, so budget real time for it rather than treating it as setup scaffolding.

The role set grows from three to seven: `platform_admin`; `agency_owner`, `agency_admin`, `recruiter`, `interviewer`; `client_admin`, `client_reviewer`. `canAccessJob` gains a third branch for client users — allowed when the job's `client_company_id` matches their membership.

One cleanup belongs in the same change. [`frontend/lib/require-role.ts`](../../frontend/lib/require-role.ts) duplicates the role mapping and has already drifted: it kept the substring match (`includes("super admin")`) that the backend explicitly removed and documented against. With seven roles across two scopes it will drift again. Collapse to one shared mapping.

---

## 6. Client visibility

Letting client staff log in means every read answers a second question beyond "which organization": *what may this particular client see?* The seams for this go in during the schema wave even though the portal itself ships later, because retrofitting redaction afterwards means auditing every serializer in the codebase.

| Surface | Default for client users | Mechanism |
| --- | --- | --- |
| Agency-internal chat | Hidden | `visibility: internal \| shared` column, defaulting to internal |
| CV match score, AI summary | Hidden | Serializer omission |
| Candidate email and phone | Withheld until placement | Field-level redaction |
| Interview feedback written by agency staff | Per-organization setting | Setting plus serializer |
| Agency fee or margin | Never exposed | Separate table clients cannot reach |

Withholding contact details is not a paranoid default; it is how agencies avoid a client hiring around them. There is no fee or placement model in the schema at all today. When one is added it should land on a table outside the client's reach from the first migration, not be bolted onto `offers`.

Implement all of it as a single `presentApplication(application, viewer)` serializer. Scattering viewer conditionals across 24 services is how the first leak happens.

---

## 7. The public surface multiplies

One careers page becomes one per client company, and several global singletons stop making sense:

| Today | Becomes |
| --- | --- |
| `public_page_settings` — one global row of allowed origins | Per client company, and **cached**: the CORS callback in [`app.ts`](../../backend/src/app.ts) currently hits the database on every request |
| `jobs.slug` globally unique | `unique(client_company_id, slug)`, served at `/careers/:clientSlug/:jobSlug` |
| `getPublicCompany` returns the singleton | Resolved from the client slug in the route |
| `pipeline_stage_templates.name` globally unique | Organization-scoped; the seed's five default stages become per-organization bootstrap |
| `templates` — no owner | Organization-scoped, with optional per-client override |
| [`mail.service.ts`](../../backend/src/shared/services/mail.service.ts) — hardcoded `OpenATS <…>` sender and footer | Per-agency sending domain and branding in Resend |
| `GOOGLE_CALENDAR_ID` env var ([`google-calendar.service.ts:27`](../../backend/src/shared/services/google-calendar.service.ts)) | Per-organization setting; a single env var is a hard single-tenant assumption |

While in there: the application-confirmation email is inline HTML sitting in [`candidate.service.ts:145`](../../backend/src/modules/candidate/candidate.service.ts) with the singleton company lookup beside it. Route it through the template engine that already exists, or it becomes the one email that never picks up agency branding.

---

## 8. Phases

The numbering is a dependency order, not a convenience.

| # | Phase | Contents | Why it sits here |
| --- | --- | --- | --- |
| 0 | Close existing authorization gaps | Wire `requireJobAccess` and `requireCandidateAccess` across the ~15 unguarded read routes; scope `job.service.getById` | Tenancy inherits these code paths. Layering `organization_id` on reads that do not check ownership buries the holes one level deeper, where a cross-tenant test cannot catch them because both records are in the same organization |
| 1 | Schema foundation | `organizations`, `client_companies`, `organization_members`; `organization_id` on all 33 tables; the candidate/application split; RLS and request-scoped context; Asgardeo sub-orgs | **Atomic — do not split across releases.** A half-migrated schema has no enforceable boundary: some tables filter, some do not, and nothing from outside tells you which |
| 2 | Agency operations | Client company management, jobs belonging to a client, submit-candidate-to-job, talent pool search, cross-client dashboard | Where the product stops being a corporate ATS with new labels. First phase with anything to demo |
| 3 | Client portal | Client roles, the client branch of `canAccessJob`, the redaction serializer, review and feedback UI, invitations | Clients review candidates that agency staff submit; without phase 2 there is nothing to look at |
| 4 | Multi-brand public surface | Per-client careers pages, per-client origins with caching, slug scoping, per-agency email branding | Nothing here blocks internal work, and the routing choice is easier once real clients exist |
| 5 | Platform operations | Agency signup and provisioning, per-organization Gemini metering, queue fairness, per-organization rate limits, tenant export and hard delete | Each item is only needed past the first paying agency, and each ships independently |

On phase 5's queue item: [`worker.ts`](../../backend/src/queues/cv-analysis/worker.ts) sets `concurrency: 3` globally, so one agency bulk-importing CVs starves every other tenant.

---

## 9. Consequences

**Phase 1 is not a feature.** It is a rewrite of the data access layer of a 14,000-line backend, plus the query hooks feeding a 37,000-line frontend: 33 tables, every one of 24 service files, and both asynchronous paths. Phases 2 to 5 are ordinary product work by comparison and can be estimated normally.

**Every query gets a transaction.** Code that currently calls `db.select()` directly will not compile, or worse, will silently run without org context. Expect the RLS wrapper to be the single most invasive diff in the project's history.

**Local development gets a setup step.** Seeding now needs an organization before anything else exists. `make setup` and [`db/seed.ts`](../../backend/src/db/seed.ts) both change, and the contributor onboarding path in `CONTRIBUTING.md` grows a step.

**Debugging gets harder.** A query returning nothing will have two possible causes — no matching rows, or wrong org context. Log the resolved `app.org_id` on every request early, before anyone loses a day to this.

**Two things make it tractable.** RLS converts the correctness question from "did we remember to filter everywhere", which is unanswerable by inspection, into a per-table policy that can be enumerated and tested. And the clean break means no backfill, no dual-write, no compatibility mode — worth more than it sounds, and it expires the moment someone puts real candidate data into a deployment.

---

## 10. Alternatives considered

### Scope by organization in application code instead of RLS

Rejected. It is the cheaper option and it is what most projects do, but the evidence in this repository argues against it: a correct, tested per-job guard reached 3 of ~70 routes. There is no reason to believe a per-tenant filter would fare better, and the consequence of missing one is categorically worse. RLS costs a transaction wrapper once; app-level scoping costs vigilance forever.

### One database or schema per tenant

Rejected. Hard isolation without RLS's per-query cost, but 33 tables times N tenants means every migration runs N times, with no way to make that atomic. Production runs on Neon, where connection pooling across many databases is its own problem. Revisit only if a single client ever contractually requires physical separation.

### Keep `candidates` fused to a job, add a `person_id` linking duplicates

Rejected. Tempting because it is a smaller migration, and it does give the talent pool a way to connect the same person's rows. But `status` and `current_stage_id` stay on a row that also claims to be a person, so "what stage is this candidate at" remains ambiguous whenever they are in two pipelines. It defers the split rather than avoiding it, and the second attempt happens with more data to migrate.

### One Asgardeo organization, membership entirely in the database

Rejected for the agency boundary, adopted within it. Keeping one IdP organization is simpler to configure and avoids reworking `setup-asgardeo.sh`. But it makes the tenant boundary purely an application concern, at exactly the layer where a bug means cross-agency access, and it contradicts the existing design where role comes from the JWT and is never stored. Sub-organizations put the boundary in the identity provider. Client contacts, who are guests of one agency and managed by that agency, are handled with membership rows.

### Subdomains for client careers pages

Deferred, not rejected. `acme.jobs.agency.com` reads better than `/careers/acme` and some clients will ask for it. It needs wildcard DNS, wildcard TLS, and per-request host resolution. Path routing costs nothing now and does not preclude adding subdomains later as an alias.

---

## 11. Open questions

These do not block phase 1 and should be settled before the phase they belong to:

- Can one candidate be submitted to two jobs at the same client company simultaneously? Affects whether `unique(candidate_id, job_id)` is enough or applications need a status-aware constraint.
- Do agencies share a talent pool across their own client companies only, or is there ever a cross-agency pool? This record assumes strictly per-agency.
- Is `interview_feedback` written by a client visible to other client users at the same company, or only to the agency?
- Does deactivating a client company hide its jobs from the careers page immediately, or only prevent new applications?

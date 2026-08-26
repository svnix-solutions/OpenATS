# OpenATS architecture

How the system is put together, and which parts you can replace.

For the tenancy rules a query has to obey, see `CLAUDE.md`. For running it,
[DEPLOYMENT.md](./DEPLOYMENT.md). For every environment variable,
[CONFIGURATION.md](./CONFIGURATION.md).

---

## The shape of it

```
                        ┌──────────────────────────┐
  browser ──────────────│  frontend (Next.js)      │
                        │  SSR, session cookie     │
                        └───────┬──────────┬───────┘
                                │          │
                     server-side│          │browser
                        fetch    │          │ fetch + socket
                                ▼          ▼
                        ┌──────────────────────────┐
                        │  backend (Express 5)     │
                        │  REST + Socket.IO        │
                        └───┬───────┬──────────┬───┘
                            │       │          │
                   ┌────────▼──┐ ┌──▼──────┐ ┌─▼─────────────┐
                   │ Postgres  │ │  Redis  │ │ identity      │
                   │ RLS per   │ │ BullMQ  │ │ provider      │
                   │ tenant    │ │ + presence│ (OIDC)       │
                   └───────────┘ └────┬────┘ └───────────────┘
                                      │
                                 ┌────▼────────┐
                                 │ CV worker   │
                                 │ (own process)│
                                 └─────────────┘
```

Four processes: the Next.js server, the API, the CV analysis worker, and
Postgres/Redis beside them. The worker is separate because CV analysis is slow
and must not hold a request open.

---

## The tenancy boundary

This is the load-bearing decision and everything else bends around it.

Every table carries `organization_id` under a **forced** row-level security
policy keyed on `app_current_org()`, which reads a per-connection setting.
`runInOrganization(id, fn)` checks out a connection, sets it, and puts the
handle in an `AsyncLocalStorage` — so services keep importing `db` and never
thread a tenant through.

Outside that context every policy sees a null organization: **reads return
nothing and writes are refused.** It fails closed, which is why a forgotten
context shows up as "no data" rather than as another tenant's data.

Six places establish it, and they are the six places a new one can be
forgotten:

| Path | Where the tenant comes from |
| --- | --- |
| Authenticated HTTP | the user's membership |
| Public HTTP | the resource named in the URL |
| Socket.IO | the connection's user |
| CV analysis worker | carried on the BullMQ job |
| OAuth callback | carried in the signed `state` |
| CV analysis broadcast | carried on the Redis pub/sub event |

The last three exist because a queue, a redirect and a pub/sub message are all
hops the context cannot survive on its own.

**Row-level security scopes rows, not the process.** Anything cached or
broadcast in Node is shared by every tenant unless its key says so. Two bugs
came from exactly that — a cache keyed `"all"`, and one global socket room.

---

## Identity is a seam, not a dependency

The system was built against WSO2 Asgardeo and now runs against
authorizer.dev. Almost nothing had to change, and that is the point.

### What the backend actually requires

```ts
const JWKS = createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URL!));
await jwtVerify(token, JWKS, { issuer: process.env.OIDC_ISSUER! });
```

A JWKS URL, an issuer, and these claims:

| Claim | Used for | Required |
| --- | --- | --- |
| `sub` | the stable user identifier | yes |
| `email` | provisioning and reconciling the local user | yes |
| `given_name`, `family_name` | display name | defaulted if absent |
| `roles` | **seeds** the membership on first sign-in only | yes |
| `org_id` | maps the token to a local organization | only for multi-tenant installs |

That is ordinary OIDC, and no provider name appears anywhere in the backend.

### What is genuinely provider-specific

Two files, both in the frontend:

- **`lib/auth/session.ts`** — exchanging credentials for a token. The rest of
  the app reads the session from an app-owned httpOnly cookie, so nothing
  downstream knows who issued it.
- **`lib/auth/directory.ts`** — creating and updating users in the provider's
  directory. There is no standard for this; SCIM2 comes closest and most
  providers do something else.

### Why roles and organizations are not really the provider's job

Since the role moved into `organization_members.role`, the token's role only
**seeds** a membership the first time someone signs in and is ignored
afterwards. Organizations live in the `organizations` table; `org_id` is only a
key used to find the right row.

So the provider does not need rich B2B features. It needs to issue a signed
token carrying an email and a role. A single-organization install does not even
need `org_id` — sign-in attaches to the only organization that exists.

---

## Replacing the identity provider

Done, against **authorizer.dev** self-hosted in Docker. The backend needed no
change at all — only the two environment variables repointed. The frontend's
provider-specific code was gathered into five files under `lib/auth`,
`components/auth` and `app/api/auth`, having previously been spread across
eleven.

Two things had to be true, and both are worth knowing before choosing a
provider:

**RS256, not HS256.** The backend verifies through a JWKS endpoint, which needs
asymmetric keys. A provider configured with a shared secret has no public key
to publish.

**The claims must arrive in one token.** OIDC conventionally puts identity in
the *id token* and leaves the access token opaque. Asgardeo puts both identity
and roles in the access token, and OpenATS inherited that assumption.
Authorizer.dev splits them — `roles` in the access token, `email` in the id
token — so neither alone satisfied the check:

```
access_token → { roles: ["super_admin"], email: null }   → 403 missing email
id_token     → { email: "…", roles: null }               → 403 no role
```

Authorizer solves this with a custom access-token script that copies the
identity claims across. Another provider might use a scope, a mapper, or a
claims policy. **This is the integration point to check first when swapping
providers** — the protocol is never the problem; the claim shape is.

If you would rather not depend on it, the alternative is to read identity from
the `userinfo` endpoint instead of the access token, which is the more
conventional OIDC design and would remove the assumption entirely.

### Rough cost of a swap

| Layer | Work |
| --- | --- |
| Backend verification | none — repoint two variables |
| Claim shape | provider configuration, as above |
| Frontend session | replace four SDK call sites |
| User management | re-implement role assignment; SCIM2 may port as-is |
| Multi-tenant mapping | supply some stable org claim, or run single-tenant |

---

## Data model, in one paragraph

`organizations` is the tenant — one recruiting agency. `client_companies` are
the companies it recruits for; every job belongs to one, and its slug addresses
that company's public careers page. `candidates` is a person, once per
organization; `applications` is one person's submission to one job. Those two
share a number space and have caused several bugs, so a parameter carrying an
application id is named `applicationId` — and `:id` on every candidate route is
an application id.

---

## What is deliberately absent

- **No message bus.** Redis carries the job queue and one pub/sub channel.
- **No service mesh.** Two processes and a worker.
- **No ORM-level tenancy.** The database enforces it, because application-level
  scoping is one forgotten `where` away from a leak.
- **No RLS policies in the Drizzle schema.** They live in hand-written
  migrations; the snapshot deliberately records RLS as disabled, and if that
  ever flips, the next generated migration will try to turn it off on every
  table. See `CLAUDE.md`.

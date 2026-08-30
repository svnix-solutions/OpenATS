# Deploying OpenATS with Komodo

[Komodo](https://komo.do) runs Docker Compose stacks on servers you own, from a
git repo, with a UI in front. This describes deploying OpenATS as one Stack.

Everything needed is in `komodo/`:

| File | What it is |
| --- | --- |
| `komodo/compose.yaml` | The stack Komodo runs: Postgres, Redis, the identity provider, migrations, API, queue worker, frontend. Publishes no ports |
| `komodo/compose.tunnel.yaml` | Joins a proxy's existing Docker network — a Cloudflare Tunnel, Traefik. Reached by container name |
| `komodo/compose.ports.yaml` | Publishes to loopback instead, for a proxy running on the host |
| `komodo/compose.build.yaml` | Builds the images on the server instead of pulling them |
| `komodo/openats.toml` | The Stack declared as a Komodo resource, for sync |
| `komodo/.env.example` | Every variable the stack needs, and why |

You need `compose.yaml` and **one** of the two overlays. Which one is the only
deployment decision this file really asks you to make; see [Reverse
proxy](#reverse-proxy).

## Why not the compose file at the repo root

`docker-compose.yml` is a developer's machine. It publishes Postgres on 5432,
ships fixed passwords, and carries a second database and a mail catcher for the
test suite. `komodo/compose.yaml` is the same application with none of that:
the database is reachable only from the stack's own network, every credential
comes from the environment, and the app services are not behind a profile.

## What Komodo does

Clones this repo onto the target server, writes the Stack's environment to a
file, and runs `docker compose up -d` from `komodo/`. The images are **pulled**
from GHCR, built by `.github/workflows/images.yml` on every push to `main`.

The server used to build them. That cost it the disk and CPU to hold a full
dependency tree and a TypeScript compiler for something it then ran once, and
it meant the running image was produced by whatever that box happened to have
installed rather than by what CI tested. `IMAGE_TAG` pins which build is
deployed; `latest` follows `main`, and a commit sha or a version tag names one
exactly.

To build on the server anyway — a fork whose CI publishes nothing, or an
uncommitted change — add `compose.build.yaml` to `file_paths`.

## Before you start

You need a Komodo Server (a machine running Periphery) and, separately:

- **Three DNS names** — one each for the frontend, the API and the identity
  provider. The stack runs its own provider; see below.
- **Cloudflare R2** (or any S3-compatible bucket) for CVs and logos.
- **Resend**, with a verified sending domain.
- **A Gemini API key** for CV analysis.

## Deploying

### 1. Create the Stack

Either import `komodo/openats.toml` through a **ResourceSync** — point one at
this repo with `resource_path = ["komodo/openats.toml"]` — or create a Stack by
hand with the same settings:

```toml
[stack.config]
server = "server-prod"          # rename to your Komodo Server
git_provider = "github.com"
git_account = "svnix-solutions"
repo = "svnix-solutions/OpenATS"
branch = "main"
run_directory = "komodo"        # what makes ../ resolve to the repo root
file_paths = ["compose.yaml", "compose.tunnel.yaml"]

# Two services are supposed to be gone once the stack is up.
ignore_services = ["authorizer-keys", "migrate"]
```

`ignore_services` is not cosmetic. `authorizer-keys` generates the signing
keypair and exits; `migrate` applies migrations and exits. Both are
`restart: no`, and both are `service_completed_successfully` dependencies of
what starts after them — so an exited container is the success case. Komodo
reads exited containers when it computes stack state, so without this a
perfectly healthy stack is reported unhealthy from the first deploy onward,
and the status stops being worth looking at.

Only those two belong in the list. Every other service is
`restart: unless-stopped`, where exiting is how it fails.

`run_directory` matters more than it looks: `compose.yaml` builds from `..` and
mounts the database init scripts from `../docker`. Run it from anywhere else
and those paths point at nothing.

### 2. Fill in the environment

Paste `komodo/.env.example` into the Stack's **Config → Environment** and fill
it in. Komodo keeps that out of the repo and passes it to
`docker compose --env-file`.

Nothing in it has a working default, and that is on purpose. Every required
variable is written `${VAR:?message}`, so a missing one stops
`docker compose` before a container starts and names what is missing:

```
required variable APP_DATABASE_PASSWORD is missing a value:
  set a password for the openats_app role
```

Better to fail there than to have the stack come up and refuse logins an hour
later for reasons nobody can see.

### 3. Deploy

Press **Deploy**. The first run builds three images and initialises the
database, so give it a few minutes. In order:

1. `postgres` starts and, because its data directory is empty, creates the
   least-privileged `openats_app` role, gives it the password you chose, and
   creates a separate `authorizer` database.
2. `authorizer-keys` generates the RS256 keypair into a volume and exits.
3. `authorizer` starts with that key.
4. `migrate` runs to completion as the database **owner** and exits.
5. `backend` and `worker` start as `openats_app`.
6. `frontend` starts once the backend is up.

## The identity provider

The stack runs [authorizer.dev](https://authorizer.dev), so a deployment stands
up on its own. To use a provider you already run, delete the `authorizer` and
`authorizer-keys` services and point `OIDC_JWKS_URL`, `OIDC_ISSUER` and
`NEXT_PUBLIC_AUTHORIZER_URL` at it — OpenATS wants an issuer and a JWKS
endpoint and nothing else.

Three things about it are not obvious, and all three cost time to find:

**The signing key is generated for you.** Authorizer takes the key as a flag
value rather than a path, and will not make one itself: started with RS256 and
no key it exits with `missing jwt private key`. `authorizer-keys` generates a
keypair into a volume on first run. That volume is the deployment's identity —
delete it and every token ever issued becomes invalid.

**Signup cannot be turned off.** OpenATS creates users through the provider's
`signup` mutation with the admin secret, because authorizer has no admin-side
create — and `--enable-signup=false` refuses that call exactly as it refuses a
stranger's. So anyone who can reach the provider can create an account. What
protects you is `AUTHORIZER_DEFAULT_ROLES`, left at `interviewer`: a
self-registered account lands on the least privilege and can do nothing an
administrator has not granted it.

**The `roles` claim is the default roles, not the user's.** Authorizer puts the
roles a session is *acting as* in `roles`, and the ones the user *may hold* in
`allowed_roles`. OpenATS seeds the membership from `roles`, so with a
least-privileged default every first sign-in attaches as an interviewer
whatever the account was created with. That is harmless — the token seeds
`organization_members.role` once and is ignored afterwards, and Settings → User
Management is what changes it — but it means the first administrator has to be
promoted by hand, once.

### 4. Bootstrap the first administrator

Sign in once through the frontend, which creates the account locally. Then, on
the server:

```bash
docker compose -f komodo/compose.yaml exec postgres \
  psql -U openats -d openats -c \
  "UPDATE organization_members SET role='super_admin'
   WHERE user_id=(SELECT id FROM users WHERE email='you@example.com');"
```

Once one administrator exists everybody else is managed from Settings → User
Management, and this is never needed again.

### 5. Seed

Once the stack is up, from the repo checkout on the server:

```bash
docker compose -f komodo/compose.yaml run --rm migrate node dist/src/db/seed.js
```

`migrate`, not `backend`, and not by accident. Seeding has to find which
organization to seed into, and reads `organizations` through the **owner** —
the application role sees no rows there outside a request, because row-level
security is doing its job. The backend container has no owner credentials and
should not.

That creates the default pipeline stages and the two email templates. Without
it there is no pipeline to put an applicant in, and no template to render an
offer letter from — an offer can be drafted and never sent.

To run more than one agency on the install, see `pnpm provision-org` in
`CONTRIBUTING.md`. **Pass `--admin`**: once a second organization exists,
Komodo or not, new sign-ins are no longer attached automatically and an
organization with no members cannot be signed in to at all.

## Two things that will bite you

**The frontend's `NEXT_PUBLIC_*` values are baked in at build time.** They are
inlined into the JavaScript, not read at runtime, so changing `NEXT_PUBLIC_API_URL`
or the provider URL needs a **rebuild** — in Komodo, a Deploy, not a Restart. A
Restart brings back a container with the old values compiled in.

**The application must connect as `openats_app`, never the owner.** Multi-tenancy
in OpenATS is Postgres row-level security, and Postgres exempts superusers and
`BYPASSRLS` roles from every policy. Connected as one, the backend serves every
tenant's data to every other tenant while every query, log line and test looks
exactly right. The server refuses to start on such a role — see
`assertTenancyIsEnforceable` in `backend/src/db/index.ts` — but only because
that check exists; the E2E suite ran that way for months without noticing.

## Updating

`webhook_enabled = true` gives the Stack a webhook URL. Add it to the
repository's webhooks and a push to `main` redeploys.

`auto_update` and `poll_for_updates` are off deliberately. They redeploy when a
newer image is found upstream, which for `postgres:17` means a database engine
upgrading itself with nobody watching. Update deliberately.

## Behind a Cloudflare Tunnel

A tunnel is the easiest way to put this on the internet from a box with no
inbound ports open: `cloudflared` dials out to Cloudflare, TLS terminates at
the edge, and nothing on the server listens publicly.

**Publish nothing.** `cloudflared` runs as a container on its own Docker
network, so the services it fronts join that network and are reached over it
by name. No host port is involved at any point — not even a loopback one.

Add the overlay to the Stack's `file_paths` and name the network:

```toml
file_paths = ["compose.yaml", "compose.tunnel.yaml"]
```

```
PROXY_NETWORK=cloudflared
```

That attaches the frontend, the API and the identity provider to it, and
nothing else: Postgres, Redis, the worker and the migration job have no reason
to be addressable from a proxy, and a shared network is shared with every other
stack on it.

**Three public hostnames**, one per service. All three must be reachable from a
browser — the frontend calls the API from the browser as well as server-side,
the Socket.IO connection goes direct, and the identity provider is where people
sign in:

| Public hostname | Tunnel service |
| --- | --- |
| `ats.example.com` | `http://openats-frontend:3000` |
| `api.example.com` | `http://openats-api:8080` |
| `auth.example.com` | `http://openats-auth:8080` |

Three things about that table are easy to get wrong:

- **The container port, not the published one.** The identity provider is
  `8080` here. `8090` was only ever the host side of a mapping that no longer
  exists.
- **`localhost` is the `cloudflared` container**, not the server. It is the
  right answer only when `cloudflared` runs on the host under systemd — in
  which case use `compose.ports.yaml` instead, which publishes to loopback.
- **The names are aliases, not service names.** `frontend` and `backend` are
  names another stack on the same shared network is entirely likely to have
  too, and whichever answers first wins.

**Set `TRUST_PROXY=1`.** This is the one that is easy to miss, because nothing
breaks visibly without it. Express reads the client address off the socket
unless told otherwise, so behind the tunnel every request appears to come from
`cloudflared`. The IP-keyed limiters on `/public/*` and `/files/logos` then
share a single bucket across the entire internet, and one bot exhausts the
application form for every real candidate. A count and never `true`: a client
writes `X-Forwarded-For` itself, so trusting the whole chain lets anyone claim
a fresh address per request and never be limited at all.

Two Cloudflare settings worth checking once it is up:

- **WebSockets on** (Network settings). Off, the dashboard loads and then never
  updates: chat, pipeline moves and new applications all arrive over Socket.IO.
- **Rocket Loader and Auto Minify off** for these hostnames. Both rewrite
  JavaScript in flight and break Next.js hydration in ways that look like
  application bugs.

Caching needs no special rules. The API sends `private, no-store` on an
authorized CV redirect and `public, max-age=300` on a logo, which is what you
want cached and what you do not.

## Reverse proxy

`compose.yaml` publishes nothing at all. Which second file you add to
`file_paths` is what decides how the stack is reached, and the two answers are
not interchangeable:

| Your proxy | Add | How it reaches the stack |
| --- | --- | --- |
| A container on its own Docker network (Cloudflare Tunnel, Traefik) | `compose.tunnel.yaml` | Joins that network. No host port exists. |
| On the host, under systemd (nginx, Caddy) | `compose.ports.yaml` | Publishes to `127.0.0.1` only. |

Prefer the first where you can. A published port is reachable from wherever the
firewall allows and stays reachable after the proxy in front of it has been
reconfigured, moved or removed — and nothing about the running stack looks any
different once that has happened.

If you do publish, keep the loopback prefix. `BACKEND_PORT=8080` binds
`0.0.0.0`.

All three hostnames need to be reachable from a browser, not only from the proxy host: the
frontend calls the backend from the browser as well as server-side, and the
Socket.IO connection goes direct. `NEXT_PUBLIC_API_URL` must be the URL a
browser can reach, with **no `/api` suffix** — the client appends the path
itself, and including it double-prefixes the dashboard and 404s every
candidate-facing page.

## Pulling the images

They are published to GHCR as `openats-backend`, `openats-migrate` and
`openats-frontend`. If the packages are private, the server needs to be logged
in once:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

A classic token with `read:packages` is enough. Making the packages public
instead removes the step; they hold no secrets, and the frontend image already
carries its `NEXT_PUBLIC_*` values in plain JavaScript by design.

**The frontend image is specific to the URLs it was built for.** `NEXT_PUBLIC_*`
values are inlined into the browser bundle at build time, so they are
repository *variables* on the images workflow rather than environment on the
Stack:

```
NEXT_PUBLIC_API_URL, NEXT_PUBLIC_APP_URL,
NEXT_PUBLIC_AUTHORIZER_URL, NEXT_PUBLIC_AUTHORIZER_CLIENT_ID
```

Set them under **Settings → Secrets and variables → Actions → Variables**.
Changing one needs the image rebuilt — re-run the workflow, then Deploy. A
Restart brings back a container with the old values compiled in. The two
backend images read everything at runtime and are not affected.

## Backups

`postgres-data` is a named Docker volume and is the whole database. Nothing in
this stack backs it up. `docker compose exec postgres pg_dump` on a schedule is
the minimum; Komodo Procedures can run it.

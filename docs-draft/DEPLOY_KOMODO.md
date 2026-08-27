# Deploying OpenATS with Komodo

[Komodo](https://komo.do) runs Docker Compose stacks on servers you own, from a
git repo, with a UI in front. This describes deploying OpenATS as one Stack.

Everything needed is in `komodo/`:

| File | What it is |
| --- | --- |
| `komodo/compose.yaml` | The stack Komodo runs: Postgres, Redis, migrations, API, queue worker, frontend |
| `komodo/openats.toml` | The Stack declared as a Komodo resource, for sync |
| `komodo/.env.example` | Every variable the stack needs, and why |

## Why not the compose file at the repo root

`docker-compose.yml` is a developer's machine. It publishes Postgres on 5432,
ships fixed passwords, and carries a second database and a mail catcher for the
test suite. `komodo/compose.yaml` is the same application with none of that:
the database is reachable only from the stack's own network, every credential
comes from the environment, and the app services are not behind a profile.

## What Komodo does

Clones this repo onto the target server, writes the Stack's environment to a
file, and runs `docker compose up -d` from `komodo/`. The images are built on
that server from the checkout, so there is no registry and no build step in
between — and no way for what runs to differ from what is committed.

## Before you start

You need a Komodo Server (a machine running Periphery) and, separately:

- **An OIDC identity provider.** OpenATS verifies tokens against a JWKS
  endpoint and does not care whose. `docs-draft/IDENTITY_PROVIDERS.md` sets out
  what it requires of one and gives the verified recipe for self-hosting
  authorizer.dev. **It is not part of this stack**, deliberately: authorizer
  takes its configuration as command-line flags including an RSA private key,
  which does not belong in a compose file next to the application it
  authenticates.
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
file_paths = ["compose.yaml"]
```

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

1. `postgres` starts and, because its data directory is empty, runs
   `docker/init-app-role.sql` to create the least-privileged `openats_app`
   role, then `docker/set-app-role-password.sh` to give it the password you set.
2. `migrate` runs to completion as the database **owner** and exits.
3. `backend` and `worker` start as `openats_app`.
4. `frontend` starts once the backend is up.

### 4. Seed, and create the first user

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

Then create your first user in the identity provider. On a single-organization
install the first person to sign in is attached to the `Default` organization
automatically and becomes its `super_admin`.

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

## Reverse proxy

The stack publishes the backend on `BACKEND_PORT` and the frontend on
`FRONTEND_PORT`, both `0.0.0.0` by default. Behind a proxy, bind them to
loopback instead:

```
BACKEND_PORT=127.0.0.1:8080
FRONTEND_PORT=127.0.0.1:3000
```

Both need to be reachable from a browser, not only from the proxy host: the
frontend calls the backend from the browser as well as server-side, and the
Socket.IO connection goes direct. `NEXT_PUBLIC_API_URL` must be the URL a
browser can reach, with **no `/api` suffix** — the client appends the path
itself, and including it double-prefixes the dashboard and 404s every
candidate-facing page.

## Backups

`postgres-data` is a named Docker volume and is the whole database. Nothing in
this stack backs it up. `docker compose exec postgres pg_dump` on a schedule is
the minimum; Komodo Procedures can run it.

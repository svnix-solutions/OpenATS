# Deploying OpenATS

**The deployment path is [DEPLOY_KOMODO.md](./DEPLOY_KOMODO.md)** — the whole
application as a Docker Compose stack: database, identity provider, API, queue
worker, frontend. That is the one that has been run end to end.

This file holds what is true of any deployment, whichever way you run it: the
images, the two database roles, and where the logs go.

There used to be a second path here — a single Azure VM running the backend
under pm2, deployed over SSH by GitHub Actions. It shipped the backend only,
depended on an `ecosystem.config.js` that was never in this repository, and
had never run successfully from this fork, which has no `SSH_HOST`. Keeping a
documented deployment that nobody could reproduce was worse than having one
fewer, so it is gone.

---


## Running the whole thing in Docker

Everything — API, worker, frontend, Postgres, Redis — behind one profile:

```bash
docker compose --profile app up -d --build
```

Without `--profile app` you get Postgres and Redis only, which is what local
development wants and what `docker compose up -d` has always done. That has not
changed.

`backend/.env` and `frontend/.env` are still required; nothing here invents
configuration. The connection strings are the exception — compose overrides
them, because the ones in `.env` point at `localhost`, which inside a container
is the container.

**First run needs two manual steps.** Migrations apply automatically (the
`migrate` service must exit cleanly before the API starts), but a fresh
database has no tenant, and stage templates belong to one:

```bash
# 1. Create an organization.
docker compose --profile app exec postgres \
  psql -U openats -d openats \
  -c "INSERT INTO organizations (name, slug) VALUES ('Your Agency','your-agency');"

# 2. Seed its pipeline stages, naming it explicitly.
ORG=$(docker compose --profile app exec -T postgres psql -U openats -d openats \
  -tAc "SELECT id FROM organizations WHERE slug='your-agency';" | tr -d ' \r')

docker compose --profile app run --rm --entrypoint sh migrate -c \
  "DATABASE_URL=postgresql://openats_app:openats_app@postgres:5432/openats \
   SEED_ORGANIZATION_ID=$ORG ./node_modules/.bin/tsx src/db/seed.ts"
```

`SEED_ORGANIZATION_ID` is not optional in practice. The seed script can also
find the organization itself when only one exists, but that path reads
`organizations` through the row-level policy with no tenant set, so it sees
nothing and reports "No organization exists" even when one does.

A job with no pipeline stages cannot take an application, so skipping step 2
gives an app that loads and cannot be used.

### What the images are

| Service | Notes |
| --- | --- |
| `backend` | `node dist/src/server.js`, non-root, production dependencies only |
| `worker` | The same image, `node dist/src/worker.js`. Without it, uploaded CVs queue and are never analysed |
| `frontend` | Next.js standalone output, non-root |
| `migrate` | The runtime image plus `drizzle-kit`, which is a devDependency and so absent from the runtime one. Runs migrations and the seed, then exits |

All three read their configuration from the environment at runtime, the
frontend included, so one build of a commit serves any deployment and changing
a URL is a restart. That took work: `NEXT_PUBLIC_*` is compiled into the
bundle, so the frontend reads non-prefixed variables and writes what the
browser needs into each page as it renders — see
`frontend/lib/public-config.ts`.

`DATABASE_URL` is pinned to `openats_app` for the app and `MIGRATION_DATABASE_URL`
to the owner for migrations, for the reason in the next section.

---


## The two database roles

This is not optional and not cosmetic.

Migrations run as the owner via `MIGRATION_DATABASE_URL`. Everything else runs
as the least-privileged `openats_app` via `DATABASE_URL`.

Postgres lets superusers and table owners **bypass row-level security**. An
application connected as the owner ignores every tenancy policy silently —
every query still works, every isolation test still passes, and nothing is
filtered. If you point `DATABASE_URL` at the owner, multi-tenancy is off and
nothing tells you.

`docker/init-app-role.sql` creates the role for local development. On a real
database, create it the same way.

---


## Logs and errors

The application writes to stdout and stderr and nothing else. Whatever runs it
is what captures and rotates them — `docker compose logs` under Komodo. A file
transport would write everything to disk twice, in a second place nothing
rotates.

With `NODE_ENV=production` each line is one JSON object, and every line carries
the `organizationId` it came from.

If `SENTRY_DSN` is set, errors are reported with that same tenant tag and with
`SENTRY_RELEASE` set to the commit it was built from, so an error can be traced
to the deploy that introduced it. Without a DSN, error tracking is simply off.

# Deploying OpenATS

This describes the deployment that exists: a single Azure VM running the
backend under pm2, deployed by GitHub Actions. It is not the only way to run
OpenATS, but it is the one that is wired up and tested.

The frontend is not deployed by this workflow. It is a standard Next.js app —
Vercel, a container, or `next build && next start` behind a reverse proxy all
work, and none of them need anything described here.

---

## What the deploy actually does

`.github/workflows/deploy.yml` runs on a push to `main` that touches
`backend/**`. It will not run if the test suite fails: the deploy job declares
`needs: test`, and that gate is the whole test workflow, not a subset.

1. **CI builds the backend** and uploads `backend/dist` as a tarball.
2. **The VM syncs source and dependencies** — `git reset --hard origin/main`,
   then `pnpm install --frozen-lockfile`.
3. **The tarball is copied** to the VM.
4. **The build is unpacked, migrations run, pm2 restarts**, and a health check
   decides whether the deploy succeeded.

**The VM does not compile.** That is deliberate: compiling there produced the
deployed artifact from whatever toolchain the box happened to have rather than
the one CI tested, which is how the two drifted apart. The VM still checks the
repository out, because migrations, `ecosystem.config.js` and the lockfile all
come from it.

`git reset --hard`, not `git pull`: any local edit on the VM makes a merge
abort, which used to leave the server quietly running stale code.

---

## What you need before the first deploy

**On GitHub** — repository secrets:

| Secret | What it is |
| --- | --- |
| `SSH_HOST` | The VM's hostname or IP |
| `SSH_USER` | The user to connect as (`azureuser` in the current script) |
| `SSH_PRIVATE_KEY` | A private key whose public half is in that user's `authorized_keys` |

> Forks do not inherit secrets. A fork's deploy workflow fails with
> `missing server host`, which is expected and means nothing is being deployed
> from it.

**On the VM:**

- Node (via nvm — the script sources `$NVM_DIR/nvm.sh`), pnpm, and pm2
- The repository cloned at `/home/azureuser/OpenATS`
- A `backend/.env` — see [CONFIGURATION.md](./CONFIGURATION.md). It is not
  deployed for you, and it is not in the repository.
- An `ecosystem.config.js` — **this file is not in the repository.** It exists
  only on the VM, and the deploy runs `pm2 restart ecosystem.config.js`
  against it. A fresh VM needs one written by hand before the first deploy can
  succeed, and nothing in CI will tell you it is missing
- Postgres reachable, with **two roles** — see the note below
- Redis reachable

Paths are hardcoded in the workflow. Deploying somewhere else means editing it.

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

## First deploy

1. Clone the repository to `/home/azureuser/OpenATS` on the VM.
2. Write `backend/.env`.
3. Install dependencies: `pnpm install --frozen-lockfile` from the root.
4. Run migrations: `pnpm --filter ./backend exec drizzle-kit migrate`.
5. Seed the pipeline stages: from `backend/`, `pnpm tsx src/db/seed.ts`.
   **The application does not work without this** — a job with no pipeline
   stages cannot take an application.
6. Start it: `pm2 start ecosystem.config.js && pm2 save`.
7. Make pm2 survive a reboot: `pm2 startup`, then run what it prints.

After that, pushes to `main` deploy themselves.

The CV analysis worker is a second process (`pnpm start:worker`). If it is not
running, uploaded CVs are queued and never analysed — no error is raised
anywhere, the analysis simply never appears.

---

## Watching a deploy

The workflow fails loudly in three places, in this order:

- **`test -f backend/dist/src/server.js`** — the tarball unpacked to nothing.
  This fails *before* pm2 is restarted onto it.
- **`drizzle-kit migrate`** — a migration failed. The old process is still
  running at this point, on the old code and the new schema. See
  [UPGRADING.md](./UPGRADING.md).
- **`curl -fsS http://localhost:8080/health`** — the app did not come back up.
  It checks the database and Redis, so it fails if either is unreachable.

`set -e` at the top of each script block is load-bearing. Without it a failed
command is ignored and the job reports success on the exit code of the last
line.

---

## Rolling back

Every deploy keeps its build tarball on the VM, in `~/releases`, named by
commit. Going back is unpacking one that is already there — no CI run, no
rebuild, no network:

```bash
./scripts/rollback.sh              # list what is available, marking the current one
./scripts/rollback.sh previous     # the one before the current
./scripts/rollback.sh <commit>     # a specific build
```

It unpacks to a temporary directory and checks the build before touching what
is running, so a truncated archive fails without taking the working build with
it. Then it restarts pm2, re-stamps `SENTRY_RELEASE` so errors are attributed
to what is actually running, and fails if `/health` does not come back.

The last **5** releases are kept. Older ones are pruned on each deploy.

### It rolls back code, not the database

Migrations only roll forward. Nothing here undoes one, and reverting the code
does not revert the schema.

- Going back **past an additive migration** — a new nullable column, a new
  table — is safe. The old code ignores what it does not know about.
- Going back **past a destructive one** — a rename, a drop, a narrowed
  constraint — is not. The old code expects something that no longer exists.
  Restore the backup instead.

The script cannot tell these apart, which is why it does not try to. Check what
the bad deploy migrated before rolling back past it.

### When to revert instead

Rolling back is for getting production working now. It leaves `main` still
containing the bad commit, so the next deploy ships it again. Follow a rollback
with a revert.

## Logs and errors

pm2 captures stdout and stderr and rotates them: `pm2 logs` (the app name is
whatever your `ecosystem.config.js` sets).
Nothing writes application log files — a file transport would write everything
to disk twice, in a second place nothing rotates.

With `NODE_ENV=production` each line is one JSON object, and every line carries
the `organizationId` it came from.

If `SENTRY_DSN` is set, errors are reported with that same tenant tag and with
`SENTRY_RELEASE` set to the deployed commit, so an error can be traced to the
deploy that introduced it. Without a DSN, error tracking is simply off.

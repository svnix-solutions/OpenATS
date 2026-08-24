# Upgrading an OpenATS install

OpenATS is pre-1.0 and makes no backwards-compatibility promise yet. This is
how to move an existing install forward, and what to watch.

---

## The normal path

```bash
git pull
pnpm install --frozen-lockfile
pnpm --filter ./backend build
pnpm --filter ./backend exec drizzle-kit migrate
pm2 restart ecosystem.config.js --update-env
```

On the deployed VM this is the workflow's job and you do not run it by hand —
see [DEPLOYMENT.md](./DEPLOYMENT.md). Locally, or on an install you manage
yourself, that is the sequence.

Check `.env.example` in both packages against your `.env` after every upgrade.
A new **required** backend variable stops the process at startup with a message
naming it. A new **optional** one is silently absent, and the feature it
controls is simply off.

---

## Migrations only roll forward

drizzle-kit has no `down`. There is no command that undoes a migration, and
reverting the code does not revert the schema.

Practically:

- **Take a backup before migrating.** It is the only way back from a
  destructive migration.
- After a failed deploy, the database is on the new schema and the process is
  on the old code. Whether that works depends entirely on the change. Adding a
  nullable column is harmless; renaming or dropping one is not.
- Rolling back means reverting the commit and deploying forward, and living
  with the schema as it is.

---

## Read a generated migration before applying it

**This is the one that can destroy your data boundary silently.**

The Drizzle schema deliberately does not declare row-level security policies —
every one lives in a hand-written migration, and the snapshots record
`isRLSEnabled: false` for all 37 tables. That mismatch is load-bearing: it is
what stops drizzle-kit having an opinion about policies.

If a snapshot ever records RLS as *enabled* — most easily by running
`drizzle-kit pull`, but also by declaring policies in TypeScript — the next
`generate` emits `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` for **every
table**. Applying it removes the entire tenancy boundary, and every isolation
test still passes, because the tests set an organization and the queries keep
working. They just stop being filtered.

This is verified, not theorised: a pulled snapshot produced exactly that
migration, thirty-plus statements long.

> **Before applying any generated migration, read it for
> `DISABLE ROW LEVEL SECURITY`.**

Some tables were changed by hand-written SQL and their snapshots do not match,
so `drizzle-kit generate` asks an interactive question it cannot answer
unattended. Use `drizzle-kit generate --custom` and write the SQL, or answer
the prompt with **"create column"**.

---

## After upgrading

- **Seed stages exist?** A job with no pipeline stages cannot take an
  application. `pnpm tsx src/db/seed.ts` is idempotent.
- **Is the worker running?** The CV analysis worker is a second process. If it
  is not up, uploaded CVs queue and are never analysed, and nothing reports an
  error.
- **Does `/health` return 200?** It checks Postgres and Redis.
- **Does a sign-in still work?** Role and organization are both resolved at
  sign-in, so this is where a tenancy or identity misconfiguration shows up
  first.

---

## Version-specific notes

### Multi-tenancy

The multi-tenancy work was a **clean break**, taken pre-release, with no
migration path from a single-tenant install. If you are running from before
it, the schema differs in ways no migration reconciles: every table gained an
`organization_id`, `candidates` was split into a person and an application, and
row-level security was enabled on all of it.

Two consequences worth knowing even on a fresh install:

- `DATABASE_URL` must be the least-privileged `openats_app` role, not the
  owner. Owners bypass row-level security, so pointing it at the owner turns
  tenancy off silently. See [CONFIGURATION.md](./CONFIGURATION.md).
- `:id` on every candidate route is an **application** id, not a person id.
  The two share a number space, so an id from one side is a valid, silently
  wrong id on the other. This has caused five bugs so far.

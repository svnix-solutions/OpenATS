# syntax=docker/dockerfile:1

# Built from the repository root, not from backend/: this is a pnpm workspace,
# so the lockfile and pnpm-workspace.yaml live a level up and the install needs
# them to resolve anything.
#
#   docker build -f backend/Dockerfile .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# Manifests only, so this layer is reused whenever source changes but
# dependencies do not — which is most of the time.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter openats-backend...

FROM deps AS build
COPY backend/ backend/
RUN pnpm --filter openats-backend build
# A self-contained tree with real directories rather than pnpm's symlinks,
# which do not survive being copied into another stage.
# --legacy because pnpm 10+ otherwise requires inject-workspace-packages,
# which changes how the whole workspace installs. Nothing here depends on a
# workspace package, so there is nothing to inject.
RUN pnpm deploy --legacy --filter=openats-backend --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Reads as JSON, one object per line, and carries the organizationId — see
# backend/src/utils/logger.ts.
WORKDIR /app

# Not root. The app writes nothing to disk, so it needs nothing more.
RUN addgroup -S openats && adduser -S openats -G openats

# node_modules from the deploy output — real directories, production only.
# Everything else from the build stage: `pnpm deploy` carries only what the
# package would publish, and dist is not that.
COPY --from=build --chown=openats:openats /out/node_modules ./node_modules
COPY --from=build --chown=openats:openats /repo/backend/dist ./dist
COPY --from=build --chown=openats:openats /repo/backend/package.json ./package.json
# Migrations are read at runtime by anything that applies them, and the seed
# reads nothing else.
COPY --from=build --chown=openats:openats /repo/backend/drizzle ./drizzle
# Read from process.cwd() at import time by config/swagger.ts, so the process
# exits on startup without it rather than degrading to no API docs.
COPY --from=build --chown=openats:openats /repo/backend/openapi.yaml ./openapi.yaml

USER openats
EXPOSE 8080

# The API. The worker is the same image with a different command — see
# compose.
CMD ["node", "dist/src/server.js"]

# drizzle-kit on its own, for the one-shot migration container.
#
# The version is read out of the real package.json rather than written here, so
# there is nothing to drift. `--ignore-workspace` because this is a standalone
# directory: without it pnpm walks up, finds pnpm-workspace.yaml, and refuses.
FROM base AS drizzlekit
COPY backend/package.json /version/package.json
WORKDIR /dk
# --allow-build=esbuild because drizzle-kit bundles it and pnpm refuses to run
# install scripts it has not been told about — as an error, not a warning. The
# workspace allows it in pnpm-workspace.yaml, which --ignore-workspace does not
# read, so it has to be said again here.
# drizzle-orm and pg alongside it, at the versions the application pins.
# drizzle-kit resolves both from its own directory rather than from /app: the
# ORM because it is a peer dependency, and the driver because drizzle-kit picks
# one at runtime and fails with a list of the four it would accept. Every
# version is read out of the real package.json, so there is nothing here to
# drift.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm add --ignore-workspace --allow-build=esbuild \
      "drizzle-kit@$(node -p "require('/version/package.json').devDependencies['drizzle-kit']")" \
      "drizzle-orm@$(node -p "require('/version/package.json').dependencies['drizzle-orm']")" \
      "pg@$(node -p "require('/version/package.json').dependencies.pg")"

# Migrations and the seed. Both run once and exit.
#
# This used to be the `build` stage — the whole workspace with every
# devDependency, 1.8 GB to run one command, built and stored on the deployment
# server. It is the runtime image plus drizzle-kit instead, which is the only
# thing it was actually there for. The seed needs `dist` and the production
# modules, and this has both because runtime does.
FROM runtime AS migrate
USER root
COPY --from=drizzlekit --chown=openats:openats /dk/node_modules /migrate/node_modules
# Read by drizzle-kit for `out` and the connection. `schema` in it points at a
# TypeScript file that is not in this image, which is fine: only `generate`
# reads the schema, and generate is a development command.
COPY --from=build --chown=openats:openats /repo/backend/drizzle.config.ts ./drizzle.config.ts
# The config says `import { defineConfig } from "drizzle-kit"`, and Node
# resolves that from the config's own directory — /app, which holds production
# modules only. The link is enough: drizzle-kit's own dependencies resolve
# through its real path, back under /migrate.
RUN ln -s /migrate/node_modules/drizzle-kit /app/node_modules/drizzle-kit
USER openats
ENV PATH="/migrate/node_modules/.bin:$PATH"

# The binary directly, not `pnpm exec`: pnpm first runs a dependency-status
# check, decides the tree is stale, and tries to install inside a container
# with no writable store. That fails before drizzle-kit ever runs.
CMD ["drizzle-kit", "migrate"]

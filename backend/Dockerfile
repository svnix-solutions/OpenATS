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

# drizzle-kit is a devDependency, so migrations cannot run from the runtime
# image. This stage keeps the full install and is what compose runs migrations
# and the seed from.
FROM build AS migrate
WORKDIR /repo/backend
# The binary directly, not `pnpm exec`: pnpm first runs a dependency-status
# check, which decides the tree is stale and tries `pnpm install --production`
# inside a container that has no writable store. That fails, and it fails
# before drizzle-kit ever runs.
CMD ["./node_modules/.bin/drizzle-kit", "migrate"]

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

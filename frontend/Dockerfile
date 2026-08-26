# syntax=docker/dockerfile:1

# Built from the repository root — pnpm workspace, so the lockfile and
# pnpm-workspace.yaml are a level up:
#
#   docker build -f frontend/Dockerfile .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter openats-frontend...

FROM deps AS build
COPY frontend/ frontend/
# NEXT_PUBLIC_* are inlined at build time, not read at runtime, so anything the
# browser needs has to be present now. They are public by definition — the
# name says so, and they end up in the JavaScript either way.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_AUTHORIZER_URL
ARG NEXT_PUBLIC_AUTHORIZER_CLIENT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_AUTHORIZER_URL=$NEXT_PUBLIC_AUTHORIZER_URL \
    NEXT_PUBLIC_AUTHORIZER_CLIENT_ID=$NEXT_PUBLIC_AUTHORIZER_CLIENT_ID
RUN pnpm --filter openats-frontend build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN addgroup -S openats && adduser -S openats -G openats

# standalone traces only the modules the server actually reaches, so this is a
# fraction of node_modules. static and public are not traced and are copied
# separately — without them the page renders with no CSS or images.
COPY --from=build --chown=openats:openats /repo/frontend/.next/standalone/ ./
COPY --from=build --chown=openats:openats /repo/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=openats:openats /repo/frontend/public ./frontend/public

USER openats
EXPOSE 3000

# The workspace layout is preserved inside standalone, so the server sits under
# frontend/ rather than at the root.
CMD ["node", "frontend/server.js"]

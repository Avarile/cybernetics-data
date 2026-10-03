ARG NODE_VERSION=22.18.0
ARG BUILD_VERSION="1.0.0-alpha"

###################################################################
# Stage 1: Install all workspaces (dev)dependencies               #
#          and generates node_modules folder(s)                   #
###################################################################

FROM node:${NODE_VERSION}-bookworm AS deps
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# This RUN executes before any WORKDIR, so corepack sees no package.json and would
# otherwise resolve `pnpm@latest`. Newer pnpm dropped bin/pnpm.cjs, which the corepack
# bundled with Node 22.18.0 hardcodes, so `latest` fails with MODULE_NOT_FOUND.
# Pin to the version in package.json `packageManager`, same as the runner stage below.
ENV COREPACK_DEFAULT_TO_LATEST=0
RUN corepack enable \
    && corepack prepare pnpm@9.13.0 --activate \
    && pnpm add npm-run-all2 zx -g

# Disabling some well-known postinstall scripts
ENV HUSKY=0

WORKDIR /workspace-install

# .npmrc must land before `pnpm fetch`, otherwise the prefetch runs without the
# pinned registry and without use-node-version=22.22.0 — so it populates the
# store under the image's Node 22.18.0, and the install below then downloads a
# second Node runtime outside this cached layer.
COPY --link package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./

RUN pnpm fetch

COPY --link . .

# CI=true suppresses pnpm's interactive "modules directories will be removed
# and reinstalled from scratch. Proceed? (Y/n)" prompt, which has no TTY to
# answer it during a build and would hang forever.
RUN CI=true pnpm install --prefer-offline --frozen-lockfile
RUN pnpm -F @teable/db-main-prisma prisma-generate --schema ./prisma/postgres/schema.prisma

###################################################################
# Stage 2: Build the app                                          #
###################################################################

FROM deps AS builder

ARG INTEGRATION_TEST
ARG BUILD_VERSION
ARG ENABLE_CSP=true
ARG SENTRY_ENABLED=true
ARG SENTRY_TRACING=true
# Workspaces built in parallel. Each Next.js build can take several GB, so on a
# small host pass --build-arg BUILD_CONCURRENCY=1 to avoid the OOM killer.
ARG BUILD_CONCURRENCY=4

ENV NODE_ENV=production \
    NEXT_BUILD_ENV_CSP=${ENABLE_CSP} \
    NEXT_BUILD_ENV_TYPECHECK=false \
    NEXT_BUILD_ENV_SENTRY_ENABLED=${SENTRY_ENABLED} \
    NEXT_BUILD_ENV_SENTRY_TRACING=${SENTRY_TRACING}

WORKDIR /app

COPY --from=deps --link /workspace-install ./

RUN set -ex; \
        echo "\nNEXT_PUBLIC_BUILD_VERSION=\"${BUILD_VERSION}\"" >> apps/nextjs-app/.env; \
# Distinguish whether it is an integration test operation
        if [ -n "$INTEGRATION_TEST" ]; then \
              pnpm -F "./packages/**" run build; \
        else \
              NODE_OPTIONS=--max-old-space-size=8192 pnpm -r --workspace-concurrency=${BUILD_CONCURRENCY} run build; \
        fi


##################################################################
# Stage 3: Post Builder                                          #
##################################################################

FROM builder AS post-builder

ENV NODE_ENV=production

WORKDIR /app

ARG UPLOAD_ASSETS_LIST=""
ARG UPLOAD_ASSETS_LIST_B64=""

RUN set -ex; \
        rm -fr node_modules; \
        pnpm nuke:node_modules; \
        chmod +x ./scripts/post-build-cleanup.mjs; \
        zx ./scripts/post-build-cleanup.mjs; \
        CI=true pnpm -F '!@teable/eslint-config-bases' --config.dedupe-peer-dependents=false install --prod --prefer-offline --frozen-lockfile; \
        pnpm -F @teable/db-main-prisma prisma-generate --schema ./prisma/postgres/schema.prisma

RUN set -ex; \
        apt-get update; \
        apt-get install -y --no-install-recommends rsync; \
        rm -rf /var/lib/apt/lists/*; \
        chmod +x ./scripts/upload-assets.mjs; \
        zx ./scripts/upload-assets.mjs --list="$UPLOAD_ASSETS_LIST" --listB64="$UPLOAD_ASSETS_LIST_B64";


##################################################################
# Stage 4: Extract a minimal image from the build                #
##################################################################

FROM tianon/gosu:1.19 AS gosu

FROM node:${NODE_VERSION}-bookworm-slim AS runner

ENV PNPM_HOME="/pnpm"

# Declared so `--build-arg NEXTJS_APP_PORT=...` actually takes effect. Without
# the ARG the expansion below always collapsed to the 3000 default.
ARG NEXTJS_APP_PORT=3000

ENV TZ=UTC \
    NODE_ENV=production \
    PORT=${NEXTJS_APP_PORT} \
    NEXTJS_DIR=apps/nextjs-app \
    PATH="$PNPM_HOME:$PATH"

RUN set -ex; \
        npm install zx -g; \
        corepack enable; \
        corepack prepare pnpm@9.13.0 --activate; \
        apt-get update; \
        apt-get install -y --no-install-recommends \
                curl \
                ca-certificates \
                openssl \
                netcat-traditional \
                wget \
    	; \
    	rm -rf /var/lib/apt/lists/*; \
        ln -s /usr/local/lib/node_modules /node_modules

# `corepack enable` only installs shims — the pnpm tarball is fetched on first
# use. start.sh runs Prisma migrations through pnpm, so without the prepare
# above a cold start silently depends on registry.npmjs.org being reachable.
# Pinned cache is baked in, so refuse to reach out at runtime: a version
# mismatch should fail loudly here rather than hang on a network call.
ENV COREPACK_ENABLE_NETWORK=0

# gosu for better su+exec command (multi-stage copy from official image)
COPY --from=gosu /gosu /usr/local/bin/gosu

WORKDIR /app

RUN set -ex; \
        addgroup --system --gid 1001 nodejs; \
        adduser --system --uid 1001 nodejs; \
# Set the correct permission for local cache
        mkdir .assets; \
        mkdir .temporary; \
        chown -R nodejs:nodejs /app

COPY --from=post-builder --chown=nodejs:nodejs /app/apps/nextjs-app/next.config.js \
        /app/apps/nextjs-app/next-i18next.config.js \
        /app/apps/nextjs-app/package.json \
        /app/apps/nextjs-app/.env \
        ./apps/nextjs-app/

COPY --from=post-builder --link --chown=1001:1001 /app/apps/nextjs-app/.next ./apps/nextjs-app/.next
COPY --from=post-builder --link --chown=1001:1001 /app/apps/nextjs-app/node_modules ./apps/nextjs-app/node_modules
COPY --from=post-builder --link --chown=1001:1001 /app/apps/nextjs-app/public ./apps/nextjs-app/public

COPY --from=post-builder --link --chown=1001:1001 /app/apps/nestjs-backend/dist ./apps/nestjs-backend/dist
COPY --from=post-builder --link --chown=1001:1001 /app/apps/nestjs-backend/node_modules ./apps/nestjs-backend/node_modules
COPY --from=post-builder --link --chown=1001:1001 /app/apps/nestjs-backend/package.json ./apps/nestjs-backend/

# mv it is necessary
COPY --from=builder --link --chown=1001:1001 /app/packages/common-i18n/ ./packages/common-i18n/

COPY --from=post-builder --link --chown=1001:1001 /app/packages ./packages
COPY --from=post-builder --link --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=post-builder --link --chown=1001:1001 /app/package.json ./package.json

COPY --from=post-builder --link --chown=1001:1001 /app/plugins/.next/standalone/plugins ./plugins
COPY --from=post-builder --link --chown=1001:1001 /app/apps/nestjs-backend/static ./static

COPY --from=post-builder --link --chown=1001:1001 /app/apps/mastra-ai/.mastra ./apps/mastra-ai/.mastra
COPY --from=post-builder --link --chown=1001:1001 /app/apps/mastra-ai/node_modules ./apps/mastra-ai/node_modules

# --chmod is explicit because COPY otherwise preserves the host file mode, and
# start.sh is the ENTRYPOINT: a checkout that loses the exec bit (a stray chmod
# sweep, a Windows clone, a tarball export) builds a perfectly good image that
# then dies at startup with `exec: "scripts/start.sh": permission denied`.
COPY --chown=nodejs:nodejs --chmod=0755 scripts/start.sh ./scripts/start.sh
COPY --chown=nodejs:nodejs scripts/db-migrate.mjs ./scripts/db-migrate.mjs
COPY --chown=nodejs:nodejs scripts/wait-for ./scripts/wait-for

ARG BUILD_VERSION
ENV BUILD_VERSION=$BUILD_VERSION

EXPOSE ${PORT}

ENTRYPOINT ["scripts/start.sh"]

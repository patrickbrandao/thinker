# Runtime is gcr.io/distroless/nodejs24-debian13 (no shell, no package
# manager, just node). Prod deps are staged on node:24-slim; the prod
# install uses --ignore-scripts so no native modules are compiled,
# which means the runtime's glibc version is invisible to node_modules.
# Build/dev stages stay on node:24-alpine — smallest base that still has
# a shell, which the build (turbo, nest) needs. All base images are
# pinned by digest.

# Stage 1: Install all dependencies (including dev deps) for the build.
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS deps
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/frontend/package.json packages/frontend/
COPY packages/backend/package.json packages/backend/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund --loglevel=error

# Stage 2: Build the frontend + backend + shared bundles.
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/frontend packages/frontend
COPY packages/backend packages/backend
COPY packages/thinker packages/thinker
RUN npx turbo build --filter=thinker-backend --filter=thinker-frontend --filter=thinker-shared
# Build-day OpenRouter/models.dev prices for THINKER_CATALOG_SYNC=false (#73,
# ADR 0003 catalogs, fetched only here). Never fails the build;
# --build-arg THINKER_PRICING_SNAPSHOT=false skips it.
ARG THINKER_PRICING_SNAPSHOT=true
COPY docker/pricing-snapshot.mjs /tmp/pricing-snapshot.mjs
RUN if [ "$THINKER_PRICING_SNAPSHOT" != "false" ]; then \
      node /tmp/pricing-snapshot.mjs packages/backend/dist/pricing-snapshot.json; \
    fi

# Stage 3: Production dependencies only. npm ci runs with --ignore-scripts
# so nothing is compiled — all runtime deps are pure JS, making the glibc
# of this stage irrelevant to the final image. --omit=optional drops the
# platform-specific binaries that vite/rollup/esbuild ship as
# optionalDependencies; without it, npm hoists @esbuild/linux-x64 (a Go
# binary) into node_modules even though `--omit=dev` strips its parent,
# and CVE scanners then flag the embedded Go stdlib.
FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS prod-deps
WORKDIR /app
RUN mkdir -p /app/request-recordings
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/frontend/package.json packages/frontend/
COPY packages/backend/package.json packages/backend/
COPY docker/third-party-notices.mjs /tmp/third-party-notices.mjs
# THIRD_PARTY_NOTICES is generated from the installed production tree before
# the pruning below deletes every LICENSE file under node_modules.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --omit=optional --ignore-scripts \
           --prefer-offline --no-audit --no-fund --loglevel=error && \
    node /tmp/third-party-notices.mjs /app /app/THIRD_PARTY_NOTICES && \
    mkdir -p packages/backend/node_modules && \
    rm -rf node_modules/typescript node_modules/@typescript node_modules/@types \
           node_modules/ts-node node_modules/acorn \
           node_modules/create-require node_modules/v8-compile-cache-lib && \
    find . -path "*/node_modules/@esbuild" -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path "*/node_modules/@vitest" -type d -exec rm -rf {} + 2>/dev/null; \
    find . -path "*/node_modules/*" \( -name "*.map" -o -name "README*" \
      -o -name "LICENSE*" -o -name "CHANGELOG*" -o -name "*.txt" \
      -o -name "*.md" -o -name "Makefile" -o -name "*.gyp" -o -name "*.gypi" \
      -o \( -name "*.ts" ! -name "*.d.ts" \) \) -delete 2>/dev/null; \
    find . -path "*/node_modules/*" -type d \( -name "__tests__" -o -name "test" \
      -o -name "tests" -o -name "docs" -o -name "example" \
      -o -name "examples" -o -name ".github" \) -exec rm -rf {} + 2>/dev/null; \
    true

# Stage 4: Distroless runtime. Runs as the built-in `nonroot` user (UID
# 65532) by default. No shell, no apk/apt, minimal CVE surface.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8 AS runtime
WORKDIR /app

# No base.digest label: a hand-written digest drifts from the FROM pin above
# on every Dependabot bump. The FROM line is the source of truth.
LABEL org.opencontainers.image.title="Thinker" \
      org.opencontainers.image.description="Open-source LLM gateway: routes your agents' requests to the right model and tracks cost, tokens and request logs." \
      org.opencontainers.image.url="https://github.com/patrickbrandao/thinker" \
      org.opencontainers.image.documentation="https://github.com/patrickbrandao/thinker/tree/main/docs" \
      org.opencontainers.image.source="https://github.com/patrickbrandao/thinker" \
      org.opencontainers.image.vendor="Thinker contributors" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.base.name="gcr.io/distroless/nodejs24-debian13:nonroot"

ENV NODE_ENV=production
ENV BIND_ADDRESS=0.0.0.0
ENV PORT=2099
# Expose the distroless node binary on PATH so `node` in docker-compose
# healthchecks (and anything else invoked with a bare command name) resolves.
ENV PATH=/nodejs/bin:$PATH

COPY --from=prod-deps --chown=nonroot:nonroot /app/node_modules node_modules
COPY --from=prod-deps --chown=nonroot:nonroot /app/packages/backend/node_modules packages/backend/node_modules
COPY --from=prod-deps --chown=nonroot:nonroot /app/request-recordings /data/request-recordings
COPY --from=prod-deps --chown=nonroot:nonroot /app/package.json package.json
COPY --from=build --chown=nonroot:nonroot /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=nonroot:nonroot /app/packages/backend/dist packages/backend/dist
COPY --from=build --chown=nonroot:nonroot /app/packages/frontend/dist packages/frontend/dist
COPY --chown=nonroot:nonroot packages/shared/package.json packages/shared/
COPY --chown=nonroot:nonroot packages/backend/package.json packages/backend/
# Thinker's license (it keeps the upstream copyright notice) and the
# notices of every bundled third-party package.
COPY --chown=nonroot:nonroot LICENSE LICENSE
COPY --from=prod-deps --chown=nonroot:nonroot /app/THIRD_PARTY_NOTICES THIRD_PARTY_NOTICES

EXPOSE 2099

# Distroless has no shell; use exec-form and a JS-only check.
# `node` resolves via the PATH we set above. We read PORT at runtime so
# the healthcheck follows whatever port the backend is actually using
# (2099 unless PORT is overridden).
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "const p=process.env.PORT||'2099';fetch(`http://127.0.0.1:${p}/api/v1/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# The distroless image's ENTRYPOINT is already ["/nodejs/bin/node"],
# so CMD only needs the script path.
CMD ["packages/backend/dist/main.js"]

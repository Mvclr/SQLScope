# syntax=docker/dockerfile:1
# Build context: repository root.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@sqlscope/sandbox-manager..."
RUN pnpm --filter "@sqlscope/sandbox-manager..." run build
# Self-contained production tree: only runtime dependencies, migrations included.
RUN pnpm --filter @sqlscope/sandbox-manager deploy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4100/health/ready || exit 1
CMD ["node", "dist/main.js"]

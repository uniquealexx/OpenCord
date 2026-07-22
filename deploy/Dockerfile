# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/tsconfig.json shared/
COPY server/package.json server/tsconfig.json server/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --filter @opencord/shared... --filter @opencord/server...

COPY shared/src shared/src
COPY server/src server/src
RUN pnpm --filter @opencord/shared build \
  && pnpm --filter @opencord/server build \
  && pnpm --filter @opencord/server --prod deploy --legacy /opt/opencord-server

FROM node:24.18.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3210

RUN groupadd --system --gid 10001 opencord \
  && useradd --system --uid 10001 --gid opencord --home-dir /app --shell /usr/sbin/nologin opencord

WORKDIR /app
COPY --from=build --chown=opencord:opencord /opt/opencord-server ./

USER opencord
EXPOSE 3210
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3210/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]

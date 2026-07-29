# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim
ARG OPENCORD_VERSION
ARG OPENCORD_RELEASE_CHANNEL
ARG OPENCORD_BUILD_COMMIT
LABEL org.opencontainers.image.title="OpenCord Server" \
  org.opencontainers.image.version=${OPENCORD_VERSION} \
  org.opencontainers.image.revision=${OPENCORD_BUILD_COMMIT} \
  org.opencontainers.image.vendor="OpenCord" \
  org.opencontainers.image.source="https://github.com/uniquealexx/OpenCord" \
  io.opencord.release.channel=${OPENCORD_RELEASE_CHANNEL}
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3210

RUN groupadd --system --gid 10001 opencord \
  && useradd --system --uid 10001 --gid opencord --home-dir /app --shell /usr/sbin/nologin opencord

WORKDIR /app
ADD --chown=opencord:opencord server-runtime-linux-x64.tar.gz ./

USER opencord
EXPOSE 3210
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3210/health').then(async r=>{const h=await r.json();if(!r.ok||h.status!=='ok'||h.service!=='opencord-server')process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]

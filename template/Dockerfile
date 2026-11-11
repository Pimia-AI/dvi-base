# syntax=docker/dockerfile:1
# El módulo «__NAME__» en imágenes. Contexto: la raíz del repo (`docker build -f __DIR__/Dockerfile .`).
# - module:     la imagen de producción (por defecto). Solo el bundle, las migraciones, las pantallas y el healthcheck.
# - module-dev: la de desarrollo: acepta el doble de Pimia (PIMIA_DOUBLE_URL) y lleva los datos de ejemplo.
# - dev-tools:  el doble de Pimia y el anfitrión de desarrollo, para el arranque local. Nunca en un servidor.
FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS node24
WORKDIR /app

FROM node24 AS build
COPY . .
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci --no-audit --no-fund
RUN npm run -s build:ui --workspace __PACKAGE__ \
 && npm run -s build --workspace @dvi-base/dev-host \
 && node --import tsx packages/module/src/build-module.ts __DIR__ /out

FROM node24 AS dev-tools
ENV NODE_ENV=development HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /out/pimia-double.cjs /out/dev-host.cjs ./
COPY --from=build --chown=node:node /app/packages/dev-host/dist ./dev-host-ui
COPY --chown=node:node __DIR__/module.json ./module.json
USER node

FROM node24 AS module-dev
ENV NODE_ENV=development HOSTNAME=0.0.0.0 PORT=3000 MIGRATIONS_DIR=/app/migrations SEEDS_DIR=/app/seeds UI_DIR=/app/ui
COPY --from=build --chown=node:node /out/server-dev.cjs ./server.cjs
COPY --from=build --chown=node:node /app/__DIR__/dist/ui ./ui
COPY --chown=node:node __DIR__/migrations ./migrations
COPY --chown=node:node __DIR__/seeds ./seeds
COPY --chown=node:node packages/module/assets/healthcheck.mjs ./healthcheck.mjs
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "server.cjs"]

FROM node24 AS module
ARG BUILD_REVISION
RUN node -e 'if (!/^[a-f0-9]{40}$/.test(process.env.BUILD_REVISION || "")) { console.error("BUILD_REVISION tiene que ser el SHA del commit"); process.exit(1) }'
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 MIGRATIONS_DIR=/app/migrations UI_DIR=/app/ui BUILD_REVISION=$BUILD_REVISION
LABEL org.opencontainers.image.revision=$BUILD_REVISION
COPY --from=build --chown=node:node /out/server.cjs ./server.cjs
COPY --from=build --chown=node:node /app/__DIR__/dist/ui ./ui
COPY --chown=node:node __DIR__/migrations ./migrations
COPY --chown=node:node packages/module/assets/healthcheck.mjs ./healthcheck.mjs
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "healthcheck.mjs"]
CMD ["node", "server.cjs"]

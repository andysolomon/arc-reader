# Builds Cadence and serves it with `vite preview`, which also holds the access gate and
# forwards the practice engine's /api/* routes to ReadAloud's web server (vite.server.ts).
# Build from the repo root: docker build -f apps/cadence/Dockerfile .
FROM node:24-slim

ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# pnpm-workspace.yaml names these, so the install fails without them.
COPY --chown=node:node patches patches/
COPY --chown=node:node apps/cadence/package.json apps/cadence/
COPY --chown=node:node packages/practice/package.json packages/practice/
RUN pnpm install --frozen-lockfile --filter @readaloud/cadence...

# The engine, the app, and the access gate it shares with ReadAloud's server.
COPY --chown=node:node tsconfig.base.json ./
COPY --chown=node:node packages/practice packages/practice/
COPY --chown=node:node apps/cadence apps/cadence/
COPY --chown=node:node apps/web/vite.gate.ts apps/web/

RUN pnpm --filter @readaloud/cadence build

WORKDIR /app/apps/cadence
EXPOSE 4183
CMD ["node_modules/.bin/vite", "preview", "--host", "0.0.0.0", "--port", "4183", "--strictPort"]

# Builds the app and serves it with `vite preview`, which also runs the /api/* proxies.
# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:24-slim

ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
RUN chown node:node /app
RUN mkdir /app/preparations && chown node:node /app/preparations
RUN mkdir /app/library && chown node:node /app/library
USER node

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node packages/tokens/package.json packages/tokens/
COPY --chown=node:node packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @readaloud/web...

COPY --chown=node:node . .

ARG VITE_API_BASE=/api/vs
ARG VITE_TTS_PROVIDER=openai
ARG VITE_DEFAULT_ENGINE=kittentts
ARG VITE_OPENAI_BASE=
ARG VITE_OPENAI_TTS_MODEL=gpt-4o-mini-tts
ARG VITE_PATOIS_MODEL=gpt-4.1-mini
ARG VITE_VISUAL_MODEL=muse-spark-1.3-contributor
ARG VITE_FISH_BASE=
ARG VITE_FISH_TTS_MODEL=s2.1-pro
RUN pnpm --filter @readaloud/web build

WORKDIR /app/apps/web
EXPOSE 4173
CMD ["node_modules/.bin/vite", "preview", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]

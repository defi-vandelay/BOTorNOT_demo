# The game server, for Railway, Fly.io or any Docker host. Build from the repo root:
#   docker build -f apps/server/Dockerfile .
FROM node:22-slim

ENV NODE_ENV=production
# Point a persistent volume at /data so points, pools and stats survive redeploys.
ENV DB_PATH=/data/botornot.db
WORKDIR /app
RUN npm install -g pnpm@10.28.0

# Every workspace manifest, so the lockfile matches; only the server and its packages get installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --prod --filter @botornot/server...

COPY packages/shared packages/shared
COPY apps/server apps/server

WORKDIR /app/apps/server
# Plain node (not pnpm start) so the server itself gets the host's stop signal and saves cleanly.
CMD ["node", "--import", "tsx", "src/index.ts"]

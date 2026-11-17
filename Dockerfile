# Podium 2027 as a container: the game server (server.mjs) plus the pages in public/.
# Podium has no npm dependencies, so there is no install step.
#
#   docker build -t podium .
#   docker run --rm -p 8080:8080 -v podium-data:/data podium
#
# The game is kept in /data/state.json: mount a disk or volume at /data, or a restart starts a fresh
# game. PORT is honoured (a cloud host injects its own). The host PIN is never written here: set
# HOST_PIN, LEADER_PIN and RACE_PIN as secrets on the host (HOSTING.md), or the default applies.
FROM node:24-alpine

# su-exec lets the entrypoint make a mounted /data writable, then drop to the unprivileged "node" user.
RUN apk add --no-cache su-exec

# HOST=0.0.0.0: listen on every interface of the container. TRUST_PROXY=none: rate limit failed PINs
# by the connecting address until the host's config names its proxy (render.yaml, fly.toml).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    TRUST_PROXY=none

WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public/ ./public/
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.mjs"]

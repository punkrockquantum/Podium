#!/bin/sh
# Container entrypoint for the Podium server.
# A host's disk or volume (Render disk, Fly volume, docker -v) is often mounted owned by root, so when
# the container starts as root this makes DATA_DIR writable by "node" and then runs the command as
# that unprivileged user. When the container already runs as a non-root user it just runs the command.
set -eu

DATA_DIR="${DATA_DIR:-/data}"

mkdir -p "$DATA_DIR" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  exec su-exec node "$@"
fi

exec "$@"

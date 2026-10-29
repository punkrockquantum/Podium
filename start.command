#!/bin/bash
# Podium 2027 launcher: double-click in Finder, or run `sh start.command`.
# Finds Node even when it is only installed through nvm, starts the server on
# localhost and opens the landing page in the default browser.

cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8080}"

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
    if command -v node >/dev/null 2>&1; then command -v node; return; fi
  fi
  newest=$(ls -d "$NVM_DIR"/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -n 1)
  if [ -n "$newest" ]; then echo "$newest"; return; fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
}

NODE="$(find_node)"
if [ -z "$NODE" ]; then
  echo "Podium needs Node.js 18 or newer, and none was found."
  echo "Install it from https://nodejs.org (or: nvm install --lts), then double-click start.command again."
  read -r -p "Press Return to close." _
  exit 1
fi

MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [ -z "$MAJOR" ] || [ "$MAJOR" -lt 18 ]; then
  echo "Podium needs Node.js 18 or newer; found $("$NODE" -v 2>/dev/null) at $NODE."
  read -r -p "Press Return to close." _
  exit 1
fi

URL="http://localhost:$PORT/"
if curl -fsS "${URL}api/health" >/dev/null 2>&1; then
  echo "Podium is already running at $URL, opening it."
  open "$URL"
  exit 0
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is used by another program:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  echo "Stop it, or run: PORT=8090 sh start.command"
  read -r -p "Press Return to close." _
  exit 1
fi

echo "Starting Podium with $("$NODE" -v) ($NODE)"
echo "Leave this window open while you play. Close it (or press Ctrl+C) to stop."
(
  for _ in $(seq 1 50); do
    if curl -fsS "${URL}api/health" >/dev/null 2>&1; then open "$URL"; exit 0; fi
    sleep 0.2
  done
) &
PORT="$PORT" exec "$NODE" server.mjs

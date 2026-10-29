#!/bin/bash
# Keep Podium running on this Mac: installs a per-user launchd LaunchAgent that starts the
# server at login and restarts it within seconds if it stops. Localhost only, port 8080.
# Usage: sh scripts/install-service.sh        (re-run after moving the folder or changing Node)
#
# PINs: HOST_PIN, LEADER_PIN and RACE_PIN are written into the LaunchAgent's EnvironmentVariables.
# Each is taken from the environment (HOST_PIN=... sh scripts/install-service.sh), otherwise asked for
# interactively (hidden input); an empty answer or a non-interactive run falls back to the rehearsal
# default with a warning. PINs: 1-64 letters, digits, "_" or "-".
set -euo pipefail

LABEL="com.podium.server"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${PORT:-8080}"
LOGS="$ROOT/data/logs"
DOMAIN="gui/$(id -u)"

find_node() {
  if [ -n "${PODIUM_NODE:-}" ] && [ -x "$PODIUM_NODE" ]; then echo "$PODIUM_NODE"; return; fi
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  local nvm="${NVM_DIR:-$HOME/.nvm}"
  local newest
  newest=$(ls -d "$nvm"/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -n 1 || true)
  if [ -n "$newest" ]; then echo "$newest"; return; fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
}

NODE="$(find_node)"
if [ -z "$NODE" ]; then
  echo "Node.js 18+ not found. Install it (https://nodejs.org or nvm install --lts) and re-run." >&2
  exit 1
fi
NODE="$(cd "$(dirname "$NODE")" && pwd)/$(basename "$NODE")"
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 18 ]; then
  echo "Podium needs Node.js 18+; $NODE is $("$NODE" -v)." >&2
  exit 1
fi

mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"

# pin_for NAME DEFAULT LABEL: the environment value, an interactive answer, or the rehearsal default.
pin_for() {
  local name="$1" fallback="$2" label="$3" value="${!1:-}"
  if [ -z "$value" ] && [ -t 0 ]; then
    read -r -s -p "$label (Enter for the rehearsal default): " value </dev/tty || value=""
    echo >&2
  fi
  if [ -z "$value" ]; then
    echo "WARNING: $name not set; using the rehearsal default. Set it before a real event." >&2
    value="$fallback"
  fi
  if ! [[ "$value" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
    echo "$name must be 1-64 letters, digits, '_' or '-'." >&2
    exit 1
  fi
  printf '%s' "$value"
}

HOST_PIN_VALUE="$(pin_for HOST_PIN 2027 "Host PIN")"
LEADER_PIN_VALUE="$(pin_for LEADER_PIN 1950 "Table leader PIN")"
RACE_PIN_VALUE="$(pin_for RACE_PIN SKO27 "Race password")"

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  sleep 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is busy. Stop the Podium window you started by hand (Ctrl+C), then re-run:" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2
  exit 1
fi

umask 077
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
    <key>PODIUM_NO_OPEN</key><string>1</string>
    <key>HOST_PIN</key><string>$HOST_PIN_VALUE</string>
    <key>LEADER_PIN</key><string>$LEADER_PIN_VALUE</string>
    <key>RACE_PIN</key><string>$RACE_PIN_VALUE</string>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/server.err.log</string>
</dict>
</plist>
PLIST

chmod 600 "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "Podium service is running: http://localhost:$PORT/"
    echo "Node: $NODE"
    echo "Logs: $LOGS/server.log"
    exit 0
  fi
  sleep 0.25
done
echo "The service was installed but is not answering yet. Check $LOGS/server.err.log" >&2
exit 1

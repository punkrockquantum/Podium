#!/bin/sh
# Run the Cloudflare Quick Tunnel to the local Podium server, restarting it after a short delay if it
# stops. Used by the LaunchAgent (scripts/install-tunnel.sh) and by the Terminal-window fallback
# (scripts/start-tunnel-window.sh). Output goes to the terminal and to the tunnel log.
#
# The log lives in ~/Library/Logs/Podium, not in the project folder: macOS privacy protection stops
# launchd agents from reading or writing ~/Documents.

LOG_DIR="${PODIUM_TUNNEL_LOG_DIR:-$HOME/Library/Logs/Podium}"
LOG="$LOG_DIR/tunnel.log"
PORT="${PORT:-8080}"
# http2 runs over TCP 443, which works on networks and VPNs that block QUIC (UDP 7844).
PROTOCOL="${PODIUM_TUNNEL_PROTOCOL:-http2}"
mkdir -p "$LOG_DIR"

find_cloudflared() {
  for candidate in "${CLOUDFLARED_BIN:-}" /opt/homebrew/bin/cloudflared /usr/local/bin/cloudflared "$HOME/bin/cloudflared"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then echo "$candidate"; return 0; fi
  done
  command -v cloudflared 2>/dev/null
}

CLOUDFLARED="$(find_cloudflared)"
if [ -z "$CLOUDFLARED" ]; then
  echo "cloudflared was not found. Install it, then run this again." | tee -a "$LOG" >&2
  exit 127
fi

while true; do
  echo "[podium] $(date -u '+%Y-%m-%dT%H:%M:%SZ') starting Cloudflare Quick Tunnel to http://127.0.0.1:$PORT ($PROTOCOL)" | tee -a "$LOG"
  "$CLOUDFLARED" tunnel --no-autoupdate --protocol "$PROTOCOL" --url "http://127.0.0.1:$PORT" 2>&1 | tee -a "$LOG"
  echo "[podium] $(date -u '+%Y-%m-%dT%H:%M:%SZ') tunnel stopped; restarting in 5 s (the public URL will change)" | tee -a "$LOG"
  sleep 5
done

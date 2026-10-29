#!/bin/sh
# Print the most recently published Cloudflare Quick Tunnel URL from the tunnel log.

LOG="${PODIUM_TUNNEL_LOG_DIR:-$HOME/Library/Logs/Podium}/tunnel.log"

if [ ! -r "$LOG" ]; then
  echo "No tunnel log yet. Run sh scripts/install-tunnel.sh (or sh scripts/start-tunnel-window.sh) first." >&2
  exit 1
fi

URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -n 1)"
if [ -z "$URL" ]; then
  echo "No Quick Tunnel URL found yet. Check $LOG." >&2
  exit 1
fi
printf '%s\n' "$URL"

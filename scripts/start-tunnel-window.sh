#!/bin/sh
# Fallback when the LaunchAgent cannot run: open a visible Terminal window that runs the Quick Tunnel
# and restarts it if it stops. The tunnel lives only while that window stays open.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
osascript -e "tell application \"Terminal\" to do script \"sh '$ROOT/scripts/run-tunnel.sh'\"" >/dev/null
echo "Opened a Terminal window running the tunnel. Keep it open. Get the URL with: sh scripts/tunnel-url.sh"

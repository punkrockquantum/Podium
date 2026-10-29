#!/bin/sh
# Stop and remove Podium's Cloudflare Quick Tunnel LaunchAgent. The local Podium service keeps running.

LABEL="com.podium.tunnel"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" "$HOME/Library/Application Support/Podium/run-tunnel.sh"
echo "Podium Quick Tunnel removed. The public URL no longer works; the local Podium service is still running."
echo "If you used the Terminal-window fallback, close that window (or press Ctrl+C in it)."

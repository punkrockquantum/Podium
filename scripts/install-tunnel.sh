#!/bin/bash
# Install Podium's account-free Cloudflare Quick Tunnel as a per-user LaunchAgent (com.podium.tunnel):
# it starts at login, restarts if it stops, and publishes http://127.0.0.1:8080 at a random
# https://*.trycloudflare.com address. Usage: sh scripts/install-tunnel.sh
#
# macOS privacy protection (TCC) stops launchd agents from touching ~/Documents, so the agent's runner
# and logs live outside the project: ~/Library/Application Support/Podium and ~/Library/Logs/Podium.
set -euo pipefail

LABEL="com.podium.tunnel"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SUPPORT="$HOME/Library/Application Support/Podium"
LOGS="$HOME/Library/Logs/Podium"
RUNNER="$SUPPORT/run-tunnel.sh"
DOMAIN="gui/$(id -u)"

find_cloudflared() {
  for candidate in "${CLOUDFLARED_BIN:-}" /opt/homebrew/bin/cloudflared /usr/local/bin/cloudflared "$HOME/bin/cloudflared"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then echo "$candidate"; return; fi
  done
  command -v cloudflared 2>/dev/null || true
}

CLOUDFLARED="$(find_cloudflared)"
if [ -z "$CLOUDFLARED" ]; then
  echo "cloudflared was not found. Install it (brew install cloudflared, or the macOS binary from" >&2
  echo "https://github.com/cloudflare/cloudflared/releases), then re-run this script." >&2
  exit 1
fi
# A binary downloaded by a script can carry Gatekeeper's quarantine flag, which stops launchd running it.
xattr -d com.apple.quarantine "$CLOUDFLARED" 2>/dev/null || true

mkdir -p "$SUPPORT" "$LOGS" "$HOME/Library/LaunchAgents"
cp "$ROOT/scripts/run-tunnel.sh" "$RUNNER"
chmod 755 "$RUNNER"
xattr -d com.apple.quarantine "$RUNNER" 2>/dev/null || true

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  sleep 1
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$RUNNER</string>
  </array>
  <key>WorkingDirectory</key><string>$SUPPORT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME</string>
    <key>CLOUDFLARED_BIN</key><string>$CLOUDFLARED</string>
    <key>PATH</key><string>$(dirname "$CLOUDFLARED"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOGS/tunnel.launchd.log</string>
  <key>StandardErrorPath</key><string>$LOGS/tunnel.launchd.log</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST" >/dev/null
: > "$LOGS/tunnel.log"
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true

for _ in $(seq 1 120); do
  if URL="$(sh "$ROOT/scripts/tunnel-url.sh" 2>/dev/null)"; then
    echo "Podium Quick Tunnel is running: $URL"
    echo "Log: $LOGS/tunnel.log"
    exit 0
  fi
  sleep 0.25
done
echo "The tunnel service was installed but has not published a URL yet. Check $LOGS/tunnel.log" >&2
exit 1

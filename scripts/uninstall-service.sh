#!/bin/bash
# Stop the Podium background service and remove it from login. The saved game in data/ is kept.
set -uo pipefail

LABEL="com.podium.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" && echo "Stopped $LABEL."
else
  echo "$LABEL is not loaded."
fi
if [ -f "$PLIST" ]; then
  rm -f "$PLIST" && echo "Removed $PLIST."
fi
echo "Your saved game in data/ was kept. Start by hand any time with: npm start"

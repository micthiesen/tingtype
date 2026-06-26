#!/usr/bin/env bash
# Force kill the tingtype service by any means necessary.

SERVICE_ID="com.tingtype.daemon"
DOMAIN="gui/$(id -u)"

# 1. Graceful SIGTERM via launchctl.
launchctl kill SIGTERM "$DOMAIN/$SERVICE_ID" 2>/dev/null && sleep 1

# 2. SIGKILL via launchctl.
launchctl kill SIGKILL "$DOMAIN/$SERVICE_ID" 2>/dev/null

# 3. Bootout so launchd stops restarting it.
launchctl bootout "$DOMAIN/$SERVICE_ID" 2>/dev/null

# 4. Kill any stragglers running the daemon.
pkill -9 -f "src/cli.ts run" 2>/dev/null

echo "Done."

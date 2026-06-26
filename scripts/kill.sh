#!/usr/bin/env bash
# Force kill the tingtype service by any means necessary.
source "$(dirname "$0")/_common.sh"

# 1. Boot out first so launchd's KeepAlive stops respawning it.
launchctl bootout "$DOMAIN/$SERVICE_ID" 2>/dev/null

# 2. Graceful SIGTERM, then SIGKILL via launchctl (in case it's mid-relaunch).
launchctl kill SIGTERM "$DOMAIN/$SERVICE_ID" 2>/dev/null && sleep 1
launchctl kill SIGKILL "$DOMAIN/$SERVICE_ID" 2>/dev/null

# 3. Kill any straggler bound to THIS repo's daemon (anchored to avoid collateral).
pkill -9 -f "$REPO_DIR/scripts/run.sh" 2>/dev/null
pkill -9 -f "$REPO_DIR/src/cli.ts run" 2>/dev/null

echo "Done."

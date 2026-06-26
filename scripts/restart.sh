#!/usr/bin/env bash
# Restart the daemon, bootstrapping first if it isn't currently loaded (so this
# works from a stopped state — kickstart alone fails if the job isn't loaded).
set -euo pipefail
source "$(dirname "$0")/_common.sh"

is_loaded || launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
launchctl kickstart -k "$DOMAIN/$SERVICE_ID"
echo "Restarted."

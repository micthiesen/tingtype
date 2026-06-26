#!/usr/bin/env bash
# No build step (Bun runs from source) — deploy just restarts to pick up changes.
set -euo pipefail
launchctl kickstart -k "gui/$(id -u)/com.tingtype.daemon"
echo "Deployed (restarted)."

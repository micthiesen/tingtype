#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"

if is_loaded; then
  launchctl bootout "$DOMAIN/$SERVICE_ID"
  echo "Stopped."
else
  echo "Not running."
fi

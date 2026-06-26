#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"

if is_loaded; then
  echo "Already running."
else
  launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
  echo "Started."
fi

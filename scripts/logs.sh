#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_common.sh"

if [ ! -f "$LOG_FILE" ]; then
  echo "No log file yet at $LOG_FILE (has the service been started?)." >&2
  echo "Waiting for it to appear…"
  until [ -f "$LOG_FILE" ]; do sleep 1; done
fi
exec tail -f "$LOG_FILE"

#!/usr/bin/env bash
# No build step (Bun runs from source) — deploy just restarts to pick up changes.
set -euo pipefail
exec bash "$(dirname "$0")/restart.sh"

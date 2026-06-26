#!/usr/bin/env bash
# Invoked by launchd. Runs the daemon straight from TypeScript source (no build).
set -euo pipefail

source "$(dirname "$0")/_common.sh"
cd "$REPO_DIR"

BUN="$(resolve_bun)" || { echo "bun not found (looked in ~/.bun, /opt/homebrew, /usr/local, PATH)" >&2; exit 127; }

# Bun auto-loads .env from the working directory.
exec "$BUN" src/cli.ts run

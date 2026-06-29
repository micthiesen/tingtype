#!/usr/bin/env bash
# Invoked by launchd. Runs the daemon straight from TypeScript source (no build).
set -euo pipefail

source "$(dirname "$0")/_common.sh"
cd "$REPO_DIR"

BUN="$(resolve_bun)" || { echo "bun not found (looked in ~/.bun, /opt/homebrew, /usr/local, PATH)" >&2; exit 127; }

# launchd hands us a minimal PATH that omits Homebrew, so the ffmpeg (capture)
# and cliclick (keypress) spawns inside the daemon can't find their binaries.
# Prepend the Homebrew bin dirs so PATH-based lookups resolve under launchd.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Bun auto-loads .env from the working directory.
exec "$BUN" src/cli.ts run

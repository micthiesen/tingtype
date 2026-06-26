#!/usr/bin/env bash
# Invoked by launchd. Runs the daemon straight from TypeScript source (no build).
set -euo pipefail

cd "$(dirname "$0")/.."

BUN="${BUN:-$HOME/.bun/bin/bun}"
[ -x "$BUN" ] || BUN="$(command -v bun)"

# Bun auto-loads .env from the working directory.
exec "$BUN" src/cli.ts run

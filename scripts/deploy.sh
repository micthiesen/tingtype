#!/usr/bin/env bash
# No build step for daemon source — both platforms run from TS source (macOS via
# the TingType.app launcher spawning bun, Linux via systemd). Deploy just restarts
# to pick up changes. (The macOS launcher only recompiles on `install`.)
set -euo pipefail
exec bash "$(dirname "$0")/restart.sh"

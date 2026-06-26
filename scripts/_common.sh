#!/usr/bin/env bash
# Shared constants + helpers, sourced by the other scripts. Not run directly.

SERVICE_ID="com.tingtype.daemon"
DOMAIN="gui/$(id -u)"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_ID.plist"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_DIR="$REPO_DIR/logs"
LOG_FILE="$LOG_DIR/tingtype.log"

# Resolve bun robustly — launchd runs with a minimal PATH, so `command -v` alone
# is unreliable; check the common install locations first.
resolve_bun() {
  local candidate
  for candidate in "${BUN:-}" "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  command -v bun 2>/dev/null
}

is_loaded() {
  launchctl print "$DOMAIN/$SERVICE_ID" &>/dev/null
}

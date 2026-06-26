#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_ID="com.tingtype.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_ID.plist"
LOG_DIR="$REPO_DIR/logs"

mkdir -p "$LOG_DIR"
cd "$REPO_DIR"

# Symlink the CLI so `tingtype` works from anywhere.
mkdir -p ~/.local/bin
ln -sf "$REPO_DIR/tingtype" ~/.local/bin/tingtype

BUN="${BUN:-$HOME/.bun/bin/bun}"
[ -x "$BUN" ] || BUN="$(command -v bun)"
echo "Using Bun: $BUN ($("$BUN" --version))"
"$BUN" install

echo "Installing launchd service..."
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_ID</string>
  <key>ProgramArguments</key>
  <array>
    <string>$REPO_DIR/scripts/run.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/tingtype.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/tingtype.log</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
EOF

# Load the plist if not already registered, then (re)start.
if ! launchctl print "gui/$(id -u)/$SERVICE_ID" &>/dev/null; then
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
fi
launchctl kickstart -k "gui/$(id -u)/$SERVICE_ID"

echo "Service installed and started."
echo "  Logs:    $LOG_DIR/tingtype.log  (tingtype logs)"
echo "  Status:  tingtype status"
echo "  Stop:    tingtype stop"
echo ""
echo "NOTE: grant Microphone AND Accessibility to the daemon, or it will detect"
echo "      but never type. See the README permissions section."

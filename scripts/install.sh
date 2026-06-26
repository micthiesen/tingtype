#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/_common.sh"

mkdir -p "$LOG_DIR"
cd "$REPO_DIR"

# Symlink the CLI so `tingtype` works from anywhere.
mkdir -p ~/.local/bin
ln -sf "$REPO_DIR/tingtype" ~/.local/bin/tingtype

BUN="$(resolve_bun)" || { echo "bun not found" >&2; exit 127; }
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
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
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

# Reload so a changed plist (e.g. moved repo) actually takes effect — kickstart
# alone re-reads the loaded definition, not the file.
if is_loaded; then
  launchctl bootout "$DOMAIN/$SERVICE_ID" 2>/dev/null || true
fi
launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
launchctl kickstart -k "$DOMAIN/$SERVICE_ID"

echo "Service installed and started."
echo "  Logs:    $LOG_FILE  (tingtype logs)"
echo "  Status:  tingtype status"
echo "  Stop:    tingtype stop"
echo ""
echo "NOTE: grant Microphone AND Accessibility to the daemon, or it will detect"
echo "      but never type. See the README permissions section."

#!/usr/bin/env bash
# Shared constants + service helpers, sourced by the other scripts. Not run
# directly. Dispatches to launchd (macOS) or systemd --user (Linux) so the same
# `tingtype <verb>` works on both.

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OS="$(uname)"

# Resolve bun robustly — service managers run with a minimal PATH, so
# `command -v` alone is unreliable; check the common install locations first.
resolve_bun() {
  local candidate
  for candidate in "${BUN:-}" "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun /usr/bin/bun; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  command -v bun 2>/dev/null
}

if [ "$OS" = "Darwin" ]; then
  # ----------------------------- launchd backend -----------------------------
  SERVICE_ID="com.tingtype.daemon"
  DOMAIN="gui/$(id -u)"
  PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_ID.plist"
  LOG_DIR="$REPO_DIR/logs"
  LOG_FILE="$LOG_DIR/tingtype.log"

  is_loaded() { launchctl print "$DOMAIN/$SERVICE_ID" &>/dev/null; }

  svc_install() {
    mkdir -p "$LOG_DIR"
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
    # Reload so a changed plist (e.g. moved repo) actually takes effect.
    if is_loaded; then
      launchctl bootout "$DOMAIN/$SERVICE_ID" 2>/dev/null || true
    fi
    launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
    launchctl kickstart -k "$DOMAIN/$SERVICE_ID"
  }

  svc_start() {
    if is_loaded; then
      echo "Already running."
    else
      launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
      echo "Started."
    fi
  }

  svc_stop() {
    if is_loaded; then
      launchctl bootout "$DOMAIN/$SERVICE_ID"
      echo "Stopped."
    else
      echo "Not running."
    fi
  }

  svc_restart() {
    is_loaded || launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
    launchctl kickstart -k "$DOMAIN/$SERVICE_ID"
    echo "Restarted."
  }

  svc_status() {
    echo "=== tingtype Service Status ==="
    echo ""
    if is_loaded; then
      local pid uptime
      pid=$(launchctl print "$DOMAIN/$SERVICE_ID" 2>/dev/null | grep -m1 'pid =' | awk '{print $3}')
      if [ -n "$pid" ] && [ "$pid" != "0" ]; then
        echo "  Status:  RUNNING (pid $pid)"
        uptime=$(ps -o etime= -p "$pid" 2>/dev/null | xargs)
        [ -n "$uptime" ] && echo "  Uptime:  $uptime"
      else
        echo "  Status:  REGISTERED (not running)"
      fi
    elif [ -f "$PLIST_PATH" ]; then
      echo "  Status:  STOPPED"
    else
      echo "  Status:  NOT INSTALLED"
    fi
    echo ""
    echo "=== Recent Logs ==="
    echo ""
    if [ -f "$LOG_FILE" ]; then
      tail -20 "$LOG_FILE"
    else
      echo "  No log file found"
    fi
  }

  svc_logs() {
    if [ ! -f "$LOG_FILE" ]; then
      echo "No log file yet at $LOG_FILE (has the service been started?)." >&2
      echo "Waiting for it to appear…"
      until [ -f "$LOG_FILE" ]; do sleep 1; done
    fi
    exec tail -f "$LOG_FILE"
  }

  svc_kill() {
    launchctl bootout "$DOMAIN/$SERVICE_ID" 2>/dev/null
    launchctl kill SIGTERM "$DOMAIN/$SERVICE_ID" 2>/dev/null && sleep 1
    launchctl kill SIGKILL "$DOMAIN/$SERVICE_ID" 2>/dev/null
    pkill -9 -f "$REPO_DIR/scripts/run.sh" 2>/dev/null
    pkill -9 -f "$REPO_DIR/src/cli.ts run" 2>/dev/null
    echo "Done."
  }

else
  # -------------------------- systemd (user) backend -------------------------
  SERVICE_ID="tingtype.service"
  UNIT_PATH="$HOME/.config/systemd/user/$SERVICE_ID"
  # journald is the log sink on Linux; this string is only for status messages.
  LOG_FILE="journald (journalctl --user -u $SERVICE_ID)"

  is_loaded() { [ -f "$UNIT_PATH" ]; }

  svc_install() {
    local bun
    bun="$(resolve_bun)" || { echo "bun not found" >&2; return 127; }
    mkdir -p "$(dirname "$UNIT_PATH")"
    cat > "$UNIT_PATH" <<EOF
[Unit]
Description=tingtype — the ting types
# ydotoold provides the uinput keypress backend; pipewire-pulse the audio capture.
After=ydotool.service pipewire-pulse.service
Wants=ydotool.service

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=$bun $REPO_DIR/src/cli.ts run
# ydotoold's default socket; %t expands to \$XDG_RUNTIME_DIR at runtime.
Environment=YDOTOOL_SOCKET=%t/.ydotool_socket
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
    # Register + start tingtype first so a missing keypress backend can't leave
    # the install half-done (install.sh runs under `set -e`).
    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_ID"
    systemctl --user restart "$SERVICE_ID"
    # ydotoold provides the keypress backend; best-effort so a missing/renamed
    # unit doesn't abort the whole install.
    systemctl --user enable --now ydotool.service ||
      echo "warning: could not enable ydotool.service — keypresses won't land until ydotoold runs" >&2
  }

  svc_start() { systemctl --user start "$SERVICE_ID" && echo "Started."; }
  svc_stop() { systemctl --user stop "$SERVICE_ID" && echo "Stopped."; }
  svc_restart() { systemctl --user restart "$SERVICE_ID" && echo "Restarted."; }
  svc_status() { systemctl --user status "$SERVICE_ID" --no-pager 2>&1 || true; }
  svc_logs() { exec journalctl --user -u "$SERVICE_ID" -f; }

  svc_kill() {
    systemctl --user kill -s SIGKILL "$SERVICE_ID" 2>/dev/null
    systemctl --user stop "$SERVICE_ID" 2>/dev/null
    pkill -9 -f "$REPO_DIR/src/cli.ts run" 2>/dev/null
    echo "Done."
  }
fi

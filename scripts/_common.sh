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
  # The launchd job runs the daemon through this generated .app wrapper (below).
  BUNDLE_ID="dev.thiesen.tingtype"
  APP_BUNDLE="$REPO_DIR/TingType.app"
  APP_EXEC="$APP_BUNDLE/Contents/MacOS/tingtype"

  is_loaded() { launchctl print "$DOMAIN/$SERVICE_ID" &>/dev/null; }

  # Generate (and ad-hoc sign) the TingType.app wrapper that launchd launches.
  # A bare launchd job runs as the generic `bun` binary, which has no stable
  # identity macOS will prompt for — so Microphone access is silently denied
  # (ffmpeg captures pure −inf dB silence) and cliclick's keystrokes are dropped,
  # both with NO error. Wrapping the launch in a signed .app gives the daemon one
  # durable TCC identity ("TingType"): macOS prompts once for the mic, lists it
  # under Accessibility, and remembers both across restarts. The bundle is
  # generated per-machine (gitignored) so the repo path is baked in wherever it
  # installs — that's what makes this reproducible across machines.
  #
  # The main executable is a COMPILED, signed Mach-O (scripts/launcher.c), not a
  # shell script: a script's process image is the interpreter and any exec to bun
  # swaps in bun's generic identity, so it can't carry the bundle identity or the
  # NSMicrophoneUsageDescription that TCC needs to even show a prompt. The launcher
  # spawns bun on the TS source and stays alive as the parent, so ffmpeg/cliclick
  # inherit TingType's identity — and because the launcher's content is fixed
  # (only the baked paths matter), its hash is stable across daemon source edits,
  # so the Mic + Accessibility grants survive every `deploy`. See launcher.c.
  build_app_bundle() {
    local bun
    bun="$(resolve_bun)" || { echo "bun not found" >&2; return 127; }
    command -v cc &>/dev/null ||
      { echo "cc not found (install Xcode Command Line Tools: xcode-select --install)" >&2; return 1; }
    mkdir -p "$APP_BUNDLE/Contents/MacOS"

    cat > "$APP_BUNDLE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>TingType</string>
  <key>CFBundleExecutable</key>
  <string>tingtype</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>tingtype listens to the line-in for the ting's chord to trigger keystrokes.</string>
</dict>
</plist>
EOF

    # Compile the launcher with the bun + repo paths baked in. Same inputs → same
    # binary → same hash → same TCC identity, so grants persist across reinstalls.
    echo "Compiling TingType.app launcher…"
    cc -O2 -o "$APP_EXEC" \
      -DBUN_PATH="\"$bun\"" \
      -DREPO_DIR="\"$REPO_DIR\"" \
      "$REPO_DIR/scripts/launcher.c" ||
      { echo "compiling launcher.c failed" >&2; return 1; }

    # Ad-hoc sign with a fixed identifier so the TCC grant survives recompiles when
    # the source is unchanged; an intended source change re-prompts, as it should.
    if command -v codesign &>/dev/null; then
      codesign --force --sign - --identifier "$BUNDLE_ID" "$APP_BUNDLE" 2>/dev/null ||
        echo "warning: codesign failed; mic/accessibility grants may not persist" >&2
    else
      echo "warning: codesign not found; the mic/accessibility prompt may not stick" >&2
    fi
  }

  svc_install() {
    mkdir -p "$LOG_DIR"
    build_app_bundle
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_ID</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP_EXEC</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <!-- launchd's minimal PATH omits Homebrew, where ffmpeg and cliclick live. -->
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
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
    # Reload so a changed plist (e.g. moved repo, or the run.sh→.app switch) takes
    # effect. bootout is asynchronous — bootstrapping before the old job is fully
    # gone returns "Input/output error (5)", so wait for it to clear, then retry.
    if is_loaded; then
      launchctl bootout "$DOMAIN/$SERVICE_ID" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do is_loaded || break; sleep 0.5; done
    fi
    local i
    for i in 1 2 3 4 5; do
      launchctl bootstrap "$DOMAIN" "$PLIST_PATH" 2>/dev/null && break
      [ "$i" = 5 ] && { echo "launchctl bootstrap failed after retries" >&2; return 1; }
      sleep 0.5
    done
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
    pkill -9 -f "$APP_EXEC" 2>/dev/null
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

  # The ydotoold daemon ships under different unit names across distros (Arch:
  # ydotoold.service; others: ydotool.service) — both just run /usr/bin/ydotoold.
  # Pick the one this system actually has so we don't start a *second* daemon
  # that races the running one for the same socket. Prefer an already-active unit.
  resolve_ydotool_unit() {
    local u
    for u in ydotoold.service ydotool.service; do
      systemctl --user is-active "$u" &>/dev/null && { echo "$u"; return 0; }
    done
    for u in ydotoold.service ydotool.service; do
      systemctl --user cat "$u" &>/dev/null && { echo "$u"; return 0; }
    done
    echo "ydotoold.service" # sensible default if the package isn't installed yet
  }

  svc_install() {
    local bun ydotool_unit
    bun="$(resolve_bun)" || { echo "bun not found" >&2; return 127; }
    ydotool_unit="$(resolve_ydotool_unit)"
    mkdir -p "$(dirname "$UNIT_PATH")"
    cat > "$UNIT_PATH" <<EOF
[Unit]
Description=tingtype — the ting types
# ydotoold provides the uinput keypress backend; pipewire-pulse the audio capture.
After=$ydotool_unit pipewire-pulse.service
Wants=$ydotool_unit

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
    # Ensure the keypress backend is enabled+running. Idempotent when it's already
    # active; best-effort so a missing/renamed unit doesn't abort the whole install.
    systemctl --user enable --now "$ydotool_unit" ||
      echo "warning: could not enable $ydotool_unit — keypresses won't land until ydotoold runs" >&2
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

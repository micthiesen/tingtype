#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/_common.sh"

cd "$REPO_DIR"

# Symlink the CLI so `tingtype` works from anywhere.
mkdir -p ~/.local/bin
ln -sf "$REPO_DIR/tingtype" ~/.local/bin/tingtype

BUN="$(resolve_bun)" || { echo "bun not found" >&2; exit 127; }
echo "Using Bun: $BUN ($("$BUN" --version))"
"$BUN" install

echo "Installing service ($OS)..."
svc_install

echo "Service installed and started."
echo "  Status:  tingtype status"
echo "  Logs:    tingtype logs"
echo "  Stop:    tingtype stop"
echo ""
if [ "$OS" = "Darwin" ]; then
  echo "NOTE: the daemon runs as TingType.app so macOS can grant it permissions."
  echo "      On first run it prompts for Microphone — click Allow. For keystrokes,"
  echo "      add TingType under System Settings → Privacy & Security → Accessibility"
  echo "      and enable it, then 'tingtype restart'. Without these it detects but"
  echo "      never types (or hears only silence). See the README permissions section."
else
  echo "NOTE: keypresses go through ydotoold (uinput). If keys never land, check"
  echo "      'systemctl --user status ydotool' and that you can access /dev/uinput"
  echo "      (member of the 'input' group or a uinput udev ACL). See the README."
fi

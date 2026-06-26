#!/usr/bin/env bash
set -euo pipefail
launchctl kickstart -k "gui/$(id -u)/com.tingtype.daemon"
echo "Restarted."

#!/usr/bin/env bash
set -euo pipefail
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.tingtype.daemon.plist
echo "Started."

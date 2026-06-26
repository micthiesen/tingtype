#!/usr/bin/env bash
set -euo pipefail
launchctl bootout "gui/$(id -u)/com.tingtype.daemon"
echo "Stopped."

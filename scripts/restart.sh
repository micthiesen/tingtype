#!/usr/bin/env bash
# Restart the daemon (bootstrapping/starting first if it isn't loaded).
set -euo pipefail
source "$(dirname "$0")/_common.sh"
svc_restart

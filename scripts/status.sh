#!/usr/bin/env bash

SERVICE_ID="com.tingtype.daemon"
DOMAIN="gui/$(id -u)"
LOG_FILE="$(cd "$(dirname "$0")/.." && pwd)/logs/tingtype.log"

print_status() {
  echo "=== tingtype Service Status ==="
  echo ""
  if launchctl print "$DOMAIN/$SERVICE_ID" &>/dev/null; then
    PID=$(launchctl print "$DOMAIN/$SERVICE_ID" 2>/dev/null | grep -m1 'pid =' | awk '{print $3}')
    if [ -n "$PID" ] && [ "$PID" != "0" ]; then
      echo "  Status:  RUNNING (pid $PID)"
      UPTIME=$(ps -o etime= -p "$PID" 2>/dev/null | xargs)
      [ -n "$UPTIME" ] && echo "  Uptime:  $UPTIME"
    else
      echo "  Status:  REGISTERED (not running)"
    fi
  else
    if [ -f "$HOME/Library/LaunchAgents/$SERVICE_ID.plist" ]; then
      echo "  Status:  STOPPED"
    else
      echo "  Status:  NOT INSTALLED"
    fi
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

if [ "${1:-}" = "--watch" ]; then
  while true; do
    output=$(print_status)
    clear
    echo "$output"
    sleep 2
  done
else
  print_status
fi

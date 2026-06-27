#!/usr/bin/env bash
source "$(dirname "$0")/_common.sh"

if [ "${1:-}" = "--watch" ]; then
  while true; do
    output=$(svc_status)
    clear
    echo "$output"
    sleep 2
  done
else
  svc_status
fi

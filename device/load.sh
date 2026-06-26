#!/usr/bin/env bash
# Generate the signature wavs and write them + config.json onto the ting.
#
# macOS can't mount the ting (it reports 4096-byte sectors), so we write the FAT
# directly with mtools. Run with sudo (the raw device is root-owned). The ting
# must be ON (push/hold the handle). See ../STATUS.md for the full hardware notes.
#
#   sudo bash device/load.sh [peak]      # peak defaults to 0.08
set -uo pipefail
export MTOOLS_SKIP_CHECK=1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" # sudo strips these (mtools/bun live here)

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PEAK="${1:-0.08}" # the CUBILUX line-in clips when hot and AGC-pumps when too quiet; ~0.08 is the sweet spot
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BUN="${BUN:-$HOME/.bun/bin/bun}"
[ -x "$BUN" ] || BUN="$(command -v bun)"

echo "Generating signature (peak $PEAK)…"
"$BUN" "$REPO_DIR/src/cli.ts" gen --out "$TMP/1.wav" --peak "$PEAK" >/dev/null
cp "$TMP/1.wav" "$TMP/2.wav"
cp "$TMP/1.wav" "$TMP/3.wav"
cp "$TMP/1.wav" "$TMP/4.wav"

# Find the ting's FAT volume (whichever disk it enumerated as).
DEV=""
for d in /dev/disk4s1 /dev/disk5s1 /dev/disk6s1 /dev/disk4 /dev/disk5 /dev/disk6; do
  if [ -b "$d" ] && minfo -i "$d" >/dev/null 2>&1; then
    DEV="$d"
    break
  fi
done
[ -n "$DEV" ] || {
  echo "ting FAT volume not found — is it on (handle pushed)? (see STATUS.md to format if needed)"
  exit 1
}
echo "Writing to $DEV…"

mcopy -o -i "$DEV" \
  "$TMP/1.wav" "$TMP/2.wav" "$TMP/3.wav" "$TMP/4.wav" "$REPO_DIR/device/config.json" ::/
mdir -i "$DEV" ::/
diskutil eject "${DEV%s1}" >/dev/null 2>&1 || diskutil eject "$DEV" >/dev/null 2>&1 || true
echo "Done. Restart the ting (release + push handle) to load the samples."

#!/usr/bin/env bash
# Generate the signature wavs and write them + config.json onto the ting.
#
# The ting must be ON (push/hold the handle). See ../STATUS.md for hardware notes.
#
#   bash device/load.sh [peak]       # peak defaults to 0.08
#
# macOS: can't mount the ting (it reports 4096-byte sectors), so we write the FAT
#   directly with mtools. Run with sudo (the raw device is root-owned).
# Linux: the kernel FAT driver handles the odd sector size, so the volume mounts
#   normally — we mount it via udisksctl (no sudo needed) and copy files in.
set -uo pipefail

OS="$(uname)"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PEAK="${1:-0.08}" # the line-in clips when hot and AGC-pumps when too quiet; ~0.08 is the sweet spot
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# sudo (macOS) strips PATH; Homebrew bins live in these. Harmless on Linux.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export MTOOLS_SKIP_CHECK=1

BUN="${BUN:-$HOME/.bun/bin/bun}"
[ -x "$BUN" ] || BUN="$(command -v bun)"

echo "Generating signature (peak $PEAK)…"
"$BUN" "$REPO_DIR/src/cli.ts" gen --out "$TMP/1.wav" --peak "$PEAK" >/dev/null
cp "$TMP/1.wav" "$TMP/2.wav"
cp "$TMP/1.wav" "$TMP/3.wav"
cp "$TMP/1.wav" "$TMP/4.wav"

FILES=("$TMP/1.wav" "$TMP/2.wav" "$TMP/3.wav" "$TMP/4.wav" "$REPO_DIR/device/config.json")

if [ "$OS" = "Darwin" ]; then
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
  mcopy -o -i "$DEV" "${FILES[@]}" ::/
  mdir -i "$DEV" ::/
  diskutil eject "${DEV%s1}" >/dev/null 2>&1 || diskutil eject "$DEV" >/dev/null 2>&1 || true
  echo "Done. Restart the ting (release + push handle) to load the samples."
else
  # Linux: locate the ting's vfat partition. Prefer the TINGDISK label; fall back
  # to the only mounted/removable vfat volume if the label differs.
  DEV="$(lsblk -rno NAME,FSTYPE,LABEL | awk '$2=="vfat" && $3=="TINGDISK" {print "/dev/"$1; exit}')"
  if [ -z "$DEV" ]; then
    DEV="$(lsblk -rno NAME,FSTYPE,RM | awk '$2=="vfat" && $3=="1" {print "/dev/"$1; exit}')"
  fi
  [ -n "$DEV" ] || {
    echo "ting FAT volume not found — is it on (handle pushed) and plugged in?"
    echo "Inspect with: lsblk -o NAME,FSTYPE,LABEL,MOUNTPOINT"
    exit 1
  }

  # Mount via udisksctl (polkit lets the local user do this without sudo).
  MNT="$(udisksctl mount -b "$DEV" 2>/dev/null | sed -n 's/^Mounted .* at \(.*\)\.\?$/\1/p')"
  if [ -z "$MNT" ]; then
    MNT="$(lsblk -rno MOUNTPOINT "$DEV" | head -n1)" # already mounted?
  fi
  [ -n "$MNT" ] || { echo "Failed to mount $DEV (try: udisksctl mount -b $DEV)"; exit 1; }

  echo "Writing to $DEV ($MNT)…"
  cp -f "${FILES[@]}" "$MNT"/
  sync
  ls -la "$MNT"
  udisksctl unmount -b "$DEV" >/dev/null 2>&1 || true
  echo "Done. Restart the ting (release + push handle) to load the samples."
fi

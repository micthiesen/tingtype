# tingtype — status & handoff

_Last updated: 2026-06-27. Read this first when picking the project back up._

## Cross-platform port (Linux) — 2026-06-27

The daemon now runs on **Linux as well as macOS** (CachyOS / KDE Wayland is the
target box). The two impure edges and the service layer dispatch on
`process.platform` / `uname`:

- **Audio:** `ffmpeg -f pulse` via PipeWire's PulseAudio compat; `pactl list
  sources` enumerates devices (`tingtype devices` verified working). Substring
  match now also checks the pulse source id, so `cubilux`/`line` will resolve once
  the real device is plugged in.
- **Keypresses:** `ydotool` (kernel `uinput`, compositor-agnostic). `actions.ts`
  maps the keyspec vocabulary → Linux input-event-codes. `ydotoold` must be
  running (`tingtype install` enables `ydotool.service`); michael already has a
  `/dev/uinput` ACL.
- **Service:** `scripts/_common.sh` defines `svc_*` functions per-OS — systemd
  `--user` unit on Linux (logs → journald), launchd on macOS. Same `tingtype
  install/start/stop/restart/status/logs/kill` verbs.
- **Device load:** `device/load.sh` has a Linux branch (udisksctl mount + cp);
  untested (no ting hardware on the Linux box yet).

**Not yet done on Linux:** end-to-end test with the real CUBILUX line-in (it
isn't plugged in yet) and a live `tingtype run`. Everything below this is the
original macOS hardware/tuning context and still applies to the signal itself.

## TL;DR

The **software is done, tested (55 passing), and works end-to-end on real
hardware** — the ting's chord is detected with a huge margin. We are stuck on
**one hardware/UX question** about the ting's `hold` playmode (below). Everything
else (detection, the gesture model, the daemon, the service scripts) is built and
green.

## ⛔ THE OPEN ISSUE (this is where we stopped)

**Every button press produces ~0.92 s of continuous tone, uniform across presses
(≈ the sample length), so every press reads as `secondary` (hold) and we can never
get `primary`.**

Last capture (3 "quick" taps) → three clean `ONSET→RELEASE` pairs of 934 / 917 /
917 ms. The uniformity (≈ the 1 s sample length) strongly suggests the tone is
**sample-driven, not button-driven** — i.e. `hold` playmode is *not* cutting the
tone on button release; it's playing the whole sample like one-shot.

**Next step — one test to settle it:** `./tingtype monitor`, do a single
*as-fast-as-physically-possible* stab tap, Ctrl-C, look at the `ONSET→RELEASE`
duration:

- **Short (<200 ms)** → `hold` works; earlier taps were just long. Tap quicker and
  you'll get `primary`. Maybe lower `hold_ms` or coach the tap.
- **Still ~0.9 s** → `hold` mode plays the full sample regardless of release.
  **Pivot the design** to a **short sample (~120 ms) + count-based gestures**:
  single tap → `primary`, double-tap → `secondary`. Drop the hold-duration path
  entirely (it's the more robust model for this hardware anyway). The span
  machine already handles double-tap; we'd just shorten the WAV and lean on the
  bridge window. Consider whether `hold` even needs to stay.

## ✅ What works (verified on hardware)

- **Detection is rock-solid.** Silence ~−55 dB / `conc≈0.001`; chord ~+31 dB /
  **`conc=1.000`**. ~80 dB of separation. No false fires.
- **No more pulsing at peak 0.08.** Three presses were perfectly clean (one
  onset/release each, zero mid-press flicker).
- Pipeline: ffmpeg(avfoundation) → FFT detector → span gesture machine → cliclick.
- `devices`, `gen`, `test`, `monitor`, `run`, `run --dry-run` all work.
- launchd service scripts (`install`/`start`/`stop`/`restart`/`status`/`logs`/`kill`).

## 🔧 What we learned (hard-won)

### Signature / detection tuning
- **Concentration was capped at 0.666** by reading a single FFT bin per tone (Hann
  leakage spreads ~⅓ into k±1). Fix: **sum the k−1/k/k+1 main lobe** → `conc≈1.0`.
- **Seamless loop is mandatory.** `hold` playmode *loops* the sample; the 5 ms edge
  fades created a dip at every loop seam → pulsing. Fix: length = exact multiple of
  1024 samples + no fades + sines start at phase 0 → click-free seam. (`gen` does
  this by default now; `--no-loop` for offline one-shots.)
- **Volume is NOT a useful lever, and quieter is worse.** Dropping to peak 0.05 made
  it *oscillate more*, not less — points at **AGC/auto-gain pumping on the CUBILUX
  line-in** (it hunts when the signal is quiet). Sweet spot ≈ **peak 0.08**. The
  line-in has **no gain knob**; user runs the ting gain maxed (best for voice), and
  may **replace the input device** eventually.

### The ting device (EP-2350)
- **`tingdisk` only appears when the ting is powered ON** (push/hold the handle);
  USB-C alone just powers it.
- **The drive reports 4096-byte sectors → macOS will NOT mount it** (the FAT driver
  needs 512-byte sectors). Firmware update did **not** change this. So Finder is out;
  write the FAT directly with **`mtools`** (see below). Re-check after any future
  firmware update — if it ever reports 512-byte sectors it'll mount normally.
- **FX echo bit us:** default presets are ECHO/SPRING/PIXIE/ROBOT and the **orange**
  button selects between "no effect" and those. ECHO made the "2-beat pulse." Keep
  orange on **"no effect"**, and our `config.json` makes all 4 presets dry as a
  belt-and-suspenders.
- **`config.json` must be valid JSON AND structurally correct** — presets need
  `pos` + `trigger` (omitting them crash-looped the unit). Recovery from a bad
  config: **hold green + white during startup** to expose the disk and fix/remove it.
- **Firmware mode is separate & easy:** double-click the small button by USB-C → a
  `TING BOOT` / `rp2350` UF2 disk that *does* mount in Finder; drag the `.uf2` on.
- Samples: `1.wav`–`4.wav` (loaded into all 4 slots so a stray green press can't
  change the sound), mono/stereo, 8/16/24/32f, ≤96 kHz, **< 1 MB total**.

## 📦 Loading samples onto the ting

macOS can't mount it, so use `device/load.sh` (writes the FAT via mtools). Needs
`brew install mtools` and **sudo** (the raw device is root-owned). Ting must be ON.

```bash
sudo bash device/load.sh            # peak 0.08 (default)
sudo bash device/load.sh 0.12       # override the level
```

Then restart the ting (release + push handle) to load. If the drive ever has **no
filesystem** (`Content: None`), format it once first:
`sudo diskutil eraseDisk MS-DOS TINGDISK MBRFormat /dev/disk4` (it still won't
auto-mount — that's expected; load.sh uses mtools anyway).

## ⚙️ Current tuning (`config.toml`)

- tones **2016 / 2484 / 3141 Hz** (bins 43 / 53 / 67 @ 1024/48k)
- detector: window 1024, hop 256, k_consecutive 4, concentration_threshold 0.5,
  per_band_min_share 0.08, release_windows 4, **refractory_ms 0** (so double-taps
  aren't swallowed), max_chord_ms 5000
- gesture: **hold_ms 400, bridge_ms 200**
- actions: primary `ctrl+opt+space`, secondary `return`
- sample on device: ~1003 ms seamless loop, **peak 0.08**, `hold` playmode

## 📋 TODO

- [ ] **Resolve the open issue** (fast-tap test → tap/hold works, or pivot to
      short-sample tap/double-tap model).
- [ ] Once `primary` vs `secondary` is reliable: drop `--dry-run`, run live.
- [ ] `tingtype install` (launchd). **Grant Microphone + Accessibility to the
      daemon's bun binary** — without Accessibility it detects but types nothing,
      silently (the #1 footgun).
- [ ] Decide whether to keep the `hold` path or go double-tap-only for `secondary`.
- [ ] (Maybe) replace the CUBILUX line-in if the AGC pumping stays annoying.

## Useful tools

- **[webcammictest.com/mic](https://webcammictest.com/mic/)** — quick in-browser
  scope/level meter for the line-in. Handy for *hearing/seeing what the input
  device actually receives* independent of our code (this is how we caught the
  ECHO "2-beat" — it showed two blobs with a gap).
- `tingtype monitor` — our own live per-band / concentration / floor readout.

## Architecture

See `CLAUDE.md` (conventions + module map) and `README.md` (usage/permissions).
Pure core (`dsp/`, `gesture.ts`) is unit-tested offline; `audio/capture.ts`
(ffmpeg) and `actions.ts` (cliclick) are the impure edges.

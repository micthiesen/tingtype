# tingtype

A cross-platform daemon (macOS + Linux) that detects a self-authored acoustic
chord from a Teenage Engineering *ting* (on a line input) and synthesizes
keypresses: short press → `ctrl+opt+space` (primary); a hold or double-tap →
Enter (secondary).

The two impure edges are platform-dispatched at runtime via `process.platform`:
audio capture is `ffmpeg -f avfoundation` (macOS) / `-f pulse` (Linux), and
keypresses are `osascript` driving System Events (macOS) / `ydotool` (Linux). The
service layer in `scripts/` likewise dispatches launchd vs systemd `--user`. On
macOS the launchd job runs a compiled launcher inside `TingType.app` (a stable,
signed TCC identity — see Hardware notes); the same TS and `config.toml` run on both.

**This is a living document — update it as conventions emerge; don't ask, just update.**

## Always commit and push

This is a personal project that should always be pushed. Commit and push whenever
something is finished, bundling any pending docs/config into the same push. No PRs,
no asking first. (No remote is configured yet — add one and push.)

## The gate

Always run `bun run check:write && bun test && bun run typecheck` after changes.

## Conventions

- **Bun runtime + package manager.** No build step — runs straight from TS source.
  Local imports use NodeNext `.js` specifiers.
- **Tests via `bun test`** (not vitest — it can't import Bun built-ins). Tests are
  co-located as `src/**/*.test.ts`; `src/test-setup.ts` is preloaded.
- **Biome** (88-col, 2-space) extends `@micthiesen/mitools/biome.shared.json`.
  Zod config; `@micthiesen/mitools` for Logger/config/pushover.
- **Strong types** (discriminated unions, explicit returns), small focused modules,
  no `console.log` debris (the CLI uses `console.log` for user-facing output by design).
- When unsure about tooling/structure/versions, check sibling projects under
  `~/Code` (especially mitools-based ones like `lobster`) and match house style.

## Architecture

```
src/
  cli.ts            # entrypoint: run / monitor / devices / gen / test + daemon lifecycle
  config.ts         # env config (mitools Injector): LOG_LEVEL, PUSHOVER, TINGTYPE_CONFIG
  appConfig.ts      # config.toml + per-machine config.local.toml merge → typed AppConfig
  gesture.ts        # span timing machine: tap→primary, hold/double-tap→secondary (pure)
  actions.ts        # keyspec parse + osascript(macOS)/ydotool(Linux) dispatch (pure parse, impure spawn)
  audio/
    devices.ts      # avfoundation + pactl device listing, ffmpeg input args, resolve (pure parsers)
    capture.ts      # ffmpeg → f32 PCM supervisor; graceful disconnect/reconnect
  dsp/
    fft.ts          # radix-2 FFT + reusable scratch
    goertzel.ts     # Goertzel power, bin/freq helpers, Hann window
    detect.ts       # chord detector: windowing → FFT bank → onset/release events
    signature.ts    # bin-snapped chord synthesis (gen)
    wav.ts          # 16-bit PCM WAV encode/decode (mono)
```

Pure core (`dsp/`, `gesture.ts`, keyspec parsing, device parsing, ffmpeg-arg and
ydotool/AppleScript keycode mapping) is unit-tested offline. Impure edges:
`audio/capture.ts` (ffmpeg) and `actions.ts` (osascript/ydotool).

## Hardware notes

- Input device: **CUBILUX HLMS-C4 Line IN** (substring-matched in `config.toml`,
  against device name *or* backend id). USB line-in, hot-plugged often — the
  capture supervisor treats a missing/dropped device as normal (polls + backoff).
- **Linux gotcha — the live line input is on a PCM PipeWire doesn't expose.** The
  CUBILUX presents *two* USB capture PCMs (`hw:HLMSC4,0` and `hw:HLMSC4,1`). The
  signal arrives on **device 1**, but PipeWire's pulse source (`CUBILUX … Analog
  Stereo`) maps to the *dead* device 0 — so a `pulse` capture reads pure digital
  silence (−91 dB). tingtype can capture `hw:HLMSC4,1` directly via `ffmpeg -f alsa`
  (it enumerates raw ALSA PCMs through `arecord -l`, backend `"alsa"`). Address
  PCMs by stable card *id* (`hw:CARD=…,DEV=…`), never the numeric card index (it
  shifts on replug). It worked on the Mac because Core Audio enumerated the right
  terminal. Diagnose with `arecord -l` + per-device `ffmpeg -f alsa -i
  hw:CARD=…,DEV=N … -af volumedetect`.
- **This host shares DEV=1 with Handy (STT) but tingtype still reads raw ALSA for
  low latency**, so the config is `input_device = "alsa:ting_shared"`. `hw:` capture
  is exclusive, so an `~/.asoundrc` **dsnoop** (`ting_shared`) fans the one hardware
  stream out to multiple readers: tingtype reads it directly (raw/snappy — routing
  through PipeWire added audible lag to tap detection), and the `ting-mic-bridge`
  user service reads the *same* dsnoop to republish a PipeWire virtual source
  **TingMic** (default source) for Handy. An `alsa:<pcm>` config spec
  ({@link parseAlsaDirectSpec}) targets a literal PCM that `arecord -l` won't list.
  Raw `hw:HLMSC4,1` also works but can't be shared. The dsnoop + bridge live in the
  `ting-mic-bridge` dotfiles stow package; see `~/.research/ting-virtual-mic.md`.
- The ting sample must use **hold/loop playmode** so a held button sustains the
  chord — that sustain is what `hold_ms` measures. The device's own
  `config.json` on TINGDISK sets `"playmode": "hold"` per slot. Load the identical
  WAV into all four slots so a stray slot-select press can't change the sound.
- **Keep the sample short (~150ms), not ~1s.** In hold playmode a tap plays one
  full pass of the sample, so the sample length is the *floor* on a tap's tone
  duration. If it exceeds `gesture.hold_ms` (400ms) every tap reads as a hold and
  fires `secondary` instead of `primary` (the original 1003ms `gen` default did
  exactly this — "plays too long", and a ~2s hold audibly looped it twice). The
  loop is phase-continuous/integer-cycle seamless, so short loops fine. `gen`
  defaults to 150ms. Pitch is unaffected by length — rate stays 48kHz, the
  detector bins are exact.
- **macOS:** capture is `ffmpeg -f avfoundation` (Homebrew). Keypresses go through
  `osascript` driving System Events (built-in) — NOT cliclick: cliclick's CGEvent
  special-keys (e.g. Return) are silently dropped by apps on recent macOS, so
  `secondary` never landed; System Events' Accessibility path delivers them.
  - **The launchd daemon runs as a signed `TingType.app`** so it has a TCC identity
    macOS will prompt for. A bare `bun` launchd job is silently denied Mic +
    Accessibility (no prompt) → ffmpeg reads `−inf dB` silence and keystrokes vanish.
    `build_app_bundle` (scripts/_common.sh) compiles `scripts/launcher.c` — a thin
    supervisor that spawns `bun src/cli.ts run` and stays alive as the parent so
    the ffmpeg/osascript children inherit the identity. The launcher's hash is
    stable across daemon source edits, so the Mic/Accessibility/Automation grants
    survive every `deploy` (which just restarts; only `install` recompiles).
    Hammerspoon is also installed if a different key backend is ever wanted.
- **Linux (this machine, CachyOS/KDE Wayland):** capture is `ffmpeg -f pulse`
  (PipeWire's pulse compat; `pactl` enumerates sources) *or* `ffmpeg -f alsa`
  (`arecord -l` enumerates raw PCMs) — `ffmpegInputArgs` picks per the device's
  `backend`; see the two-PCM gotcha above. Keypresses `ydotool`
  (needs `ydotoold` running + `/dev/uinput` access). ydotool speaks raw keycodes,
  so `actions.ts` maps the keyspec vocabulary to Linux input-event-codes.

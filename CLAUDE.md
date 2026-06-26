# tingtype

A macOS daemon that detects a self-authored acoustic chord from a Teenage
Engineering *ting* (on a line input) and synthesizes keypresses: short press →
`ctrl+opt+space`, long hold → Enter (fires at the hold threshold, not on release).

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
  appConfig.ts      # config.toml tuning (audio/detector/gesture/actions) → typed AppConfig
  gesture.ts        # tap-vs-hold timing state machine (pure; injected clock)
  actions.ts        # keyspec parse + cliclick dispatch (pure parse, impure spawn)
  audio/
    devices.ts      # avfoundation device listing + substring resolve (pure parser)
    capture.ts      # ffmpeg → f32 PCM supervisor; graceful disconnect/reconnect
  dsp/
    fft.ts          # radix-2 FFT + reusable scratch
    goertzel.ts     # Goertzel power, bin/freq helpers, Hann window
    detect.ts       # chord detector: windowing → FFT bank → onset/release events
    signature.ts    # bin-snapped chord synthesis (gen)
    wav.ts          # 16-bit PCM WAV encode/decode (mono)
```

Pure core (`dsp/`, `gesture.ts`, keyspec parsing, device parsing) is unit-tested
offline. Impure edges: `audio/capture.ts` (ffmpeg) and `actions.ts` (cliclick).

## Hardware notes

- Input device: **CUBILUX HLMS-C4 Line IN** (substring-matched in `config.toml`).
- The ting sample must use **hold/loop playmode** so a held button sustains the
  chord — that sustain is what `hold_ms` measures. Load the identical WAV into all
  four slots so a stray slot-select press can't change the sound.
- Capture uses `ffmpeg -f avfoundation`; keypresses use `cliclick` (both via Homebrew).
  Hammerspoon is also installed if a different key backend is ever wanted.

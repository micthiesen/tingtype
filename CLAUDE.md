# tingtype

Cross-platform Bun daemon that detects a self-authored acoustic chord from a
Teenage Engineering ting and synthesizes keys. A tap sends `ctrl+opt+space`; a
hold or double tap sends Enter.

Update this file when work establishes or changes a durable project convention.

## Delivery and gate

This personal project ships directly to `origin/main`. When scoped work is
finished, preserve unrelated changes, pull with rebase if needed, run the gate,
commit, and push without asking again. Do not open a PR.

```bash
bun run check:write
bun test
bun run typecheck
```

Use Bun for the runtime, package manager, and tests. Source runs directly as
TypeScript with NodeNext `.js` import specifiers. Biome extends
`@micthiesen/mitools/biome.shared.json`. Prefer strong types, discriminated
unions, small modules, and no debug output.

Tests use `bun test`, not Vitest, because Vitest cannot import the Bun built-ins
used here. Keep tests beside source as `src/**/*.test.ts`; Bun preloads
`src/test-setup.ts`. Use Zod for configuration and mitools for Logger, config,
and Pushover. CLI `console.log` calls are intentional user-facing output; remove
only debug logging.

## Architecture

The pure core covers gesture timing, DSP, WAV generation, keyspec parsing,
device parsing, and backend argument/keycode mapping. Keep it unit-testable
offline. The impure edges are audio capture and key injection:

- macOS: `ffmpeg -f avfoundation` and `osascript` through System Events.
- Linux: Pulse/PipeWire or direct ALSA capture, and `ydotool` through uinput.

Service scripts dispatch between launchd and systemd user services. Config is
loaded from `config.toml` plus per-machine `config.local.toml`.

## Audio and hardware invariants

- The CUBILUX HLMS-C4 exposes two capture PCMs. The live signal is device 1;
  PipeWire's advertised analog source maps to silent device 0. For direct
  capture, use stable `hw:CARD=...,DEV=...` identifiers, never the numeric card
  index. Diagnose with `arecord -l` and per-device FFmpeg `volumedetect`.
- This host uses `input_device = "alsa:ting_shared"`. The `ting_shared` dsnoop in
  the dotfiles lets tingtype read raw ALSA with low latency while the
  `ting-mic-bridge` service republishes the same stream as PipeWire source
  `TingMic` for Handy. Raw `hw:HLMSC4,1` is valid but exclusive.
- The ting sample uses hold/loop playmode and is loaded identically into all four
  slots. Keep it about 150 ms. A sample longer than the 400 ms gesture hold
  threshold makes taps register as holds. Preserve exact-bin, phase-continuous
  synthesis at 48 kHz.
- Missing or unplugged input is normal. Capture supervision polls and reconnects
  with backoff.

## macOS invariants

The launchd daemon runs through the signed `TingType.app` launcher so microphone,
Accessibility, and Automation permissions attach to a stable TCC identity. A bare
Bun launchd process silently loses those capabilities. `build_app_bundle` compiles
the launcher; routine `deploy` restarts without replacing that identity.

Use System Events for key injection. `cliclick` special-key CGEvents are dropped
by some current applications.

After an audio-stack restart, avfoundation can stop producing data while FFmpeg
remains alive and ignores SIGTERM. Keep the no-data watchdog and SIGKILL cleanup
in `capture.ts`; removing either can wedge the device across daemon restarts.

## Linux invariants

`ffmpegInputArgs` selects Pulse or ALSA from the resolved device backend.
`arecord -l` discovers hardware PCMs; an `alsa:<pcm>` configuration targets a
literal ALSA PCM such as the dsnoop name. `ydotoold` must be running with access
to `/dev/uinput`, and `actions.ts` maps the keyspec vocabulary to Linux input
event codes.

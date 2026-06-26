# tingtype

> The ting types.

A macOS daemon that listens to a [Teenage Engineering EP–2350 *ting*](https://teenage.engineering)
on a line input, detects a self-authored acoustic signature when you press the
white sample button, and synthesizes keypresses:

- **Short press** → `ctrl+opt+space`
- **Long hold** → `Enter` (fires the instant the hold threshold is crossed, not on release)

One physical button drives both actions; tap vs. hold is decoded in software from
the *duration* of the chord the ting plays. The signature is a short 3-tone chord;
detection is a Goertzel/FFT filter bank at those exact frequencies, so it shrugs
off the ting's lo-fi DAC, the interface's ADC, and level drift, and effectively
never false-fires on speech.

## How it works

```
CUBILUX Line IN  →  ffmpeg (avfoundation, 48k mono f32)  →  Detector (FFT bank)
                                                              │ onset / release
                                                              ▼
                                              GestureDecoder (tap vs hold)
                                                              │ tap / hold
                                                              ▼
                                                 cliclick (CGEvent keypress)
```

The detector and gesture decoder are pure and unit-tested offline; the ffmpeg
capture and cliclick dispatch are the only impure edges.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- `ffmpeg` (audio capture) and `cliclick` (keypresses): `brew install ffmpeg cliclick`
- The ting's 3.5mm **line out** into a line input that shows up as a Core Audio
  device (here: *CUBILUX HLMS-C4 Line IN*). The MacBook combo jack is not a valid source.

## Quick start

```bash
bun install
tingtype devices                 # confirm the interface shows up
tingtype gen --out signature.wav # synthesize the chord; copy to the ting (below)
tingtype monitor                 # tap the ting, watch the 3 bands light up, tune
tingtype run                     # the real thing: detect → type
```

`tingtype` (the repo-root script) routes service verbs to `scripts/` and
everything else to the Bun CLI. `tingtype install` symlinks it into `~/.local/bin`.

## Device setup (one-time, manual)

1. `tingtype gen --out 1.wav`, then copy the **same file to `1.wav`, `2.wav`,
   `3.wav`, `4.wav`** on the `TINGDISK` volume. Loading all four slots means an
   accidental **green** (slot-select) press can't change the emitted sound.
2. Set the white sample to a **dry / no-effect preset** (orange → no effect; put
   the `SAMPLE` block last in the chain) so FX never smear the waveform.
3. Set that sample's **playmode to hold/loop** so the chord *sustains while the
   white button is held* — this is what makes long-hold distinguishable from a tap.
4. Power the ting over **USB-C** so it stays live without holding the handle.

## Tuning (`config.toml`)

All detector/gesture/action parameters live in `config.toml`. Calibrate against
your *actual* signal with `tingtype monitor`: tap the ting, confirm all three
bands clear the floor with margin and `conc` jumps well above
`concentration_threshold`, then copy the suggested `noise_floor` it prints on exit.
If the ting rolls off the top tone, lower the `tones` and regenerate.

Key gesture knobs:

- `hold_ms` (default 400) — a chord sustained this long fires `hold`.
- A quick tap must be **shorter** than `hold_ms`; the ~150ms sample gives clean
  separation. Raise `hold_ms` if quick taps occasionally register as holds.

## macOS permissions (the classic footguns)

- **Microphone (TCC):** the process needs mic access to open the input device.
  Running `tingtype monitor` / `run` from a terminal triggers the prompt; the
  *terminal app* is the grantee. System Settings → Privacy & Security → Microphone.
- **Accessibility:** `cliclick` posts CGEvents, which requires the process (or its
  parent terminal) under System Settings → Privacy & Security → **Accessibility**.
  Without it, detection works but **no keys land, with no error.** This is the #1
  "why isn't it typing" cause.

For the launchd daemon, grant these to the binary that runs it (Bun). The simplest
path: get it working under `tingtype run` in a terminal first (grant both prompts),
then `tingtype install`.

## Service management

```bash
tingtype install   # symlink CLI + install & start the launchd agent (RunAtLoad, KeepAlive)
tingtype status    # running? + recent logs
tingtype logs      # tail the log
tingtype restart   # pick up config/code changes (no build step)
tingtype stop      # unload the agent
```

The daemon treats a **disconnected input device as a normal state**: if the
interface is unplugged it waits and polls for it to come back; if a live stream
drops it reconnects with backoff. It never crashes on device loss.

## Commands

| Command | Purpose |
| --- | --- |
| `tingtype run` | Start the detect → gesture → keypress pipeline |
| `tingtype monitor` | Live band/concentration/floor readout for tuning (no keypresses) |
| `tingtype devices` | List Core Audio input devices |
| `tingtype gen [--out PATH] [--tones a,b,c] [--duration-ms N]` | Synthesize the signature WAV |
| `tingtype test [--wav PATH]` | Run a WAV (or a synthesized chord) through the detector offline |

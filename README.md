# tingtype

> The ting types.

A cross-platform daemon (macOS + Linux) that listens to a
[Teenage Engineering EP–2350 *ting*](https://teenage.engineering) on a line
input, detects a self-authored acoustic signature when you press the white sample
button, and synthesizes keypresses:

- **Single tap** → `ctrl+opt+space` (primary)
- **Hold _or_ double-tap** → `Enter` (secondary)

One physical button drives both actions, decoded in software from the *duration*
and *count* of the tone the ting plays. A lone short tap is the primary; the
secondary fires on either a sustained hold (the instant it crosses the hold
threshold — not on release) or a quick double-tap. Brief gaps shorter than the
bridge window are merged, so a double-tap reads as one gesture. The signature is
a sustained 3-tone chord; detection is an FFT filter bank at those exact
frequencies, so it shrugs off the ting's lo-fi DAC, the interface's ADC, and
level drift (it's level-independent — robust even to overlapping tones), and
effectively never false-fires on speech.

## How it works

```
Line IN  →  ffmpeg (avfoundation / pulse, 48k mono f32)  →  Detector (FFT bank)
                                                              │ onset / release
                                                              ▼
                                       GestureDecoder (span: tap / hold / double-tap)
                                                              │ primary / secondary
                                                              ▼
                                          cliclick (macOS) / ydotool (Linux) keypress
```

The detector and gesture decoder are pure and unit-tested offline; the ffmpeg
capture and the keypress dispatch are the only impure edges. Both edges are
platform-dispatched at runtime (`process.platform`), so the same code and
`config.toml` run on either OS.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- The ting's 3.5mm **line out** into a line input that shows up as an audio input
  device (here: *CUBILUX HLMS-C4 Line IN*). A laptop's combo jack is not a valid source.

**macOS:**

- `ffmpeg` (audio capture via avfoundation) and `cliclick` (keypresses):
  `brew install ffmpeg cliclick`

**Linux (PipeWire/PulseAudio + a Wayland or X11 session):**

- `ffmpeg` (audio capture via the pulse demuxer) and `pulseaudio`/`pipewire-pulse`
  for `pactl` device enumeration — both present on a stock PipeWire desktop.
- `ydotool` + `ydotoold` for keypresses. ydotool injects at the kernel `uinput`
  layer, so it works under any Wayland compositor (KDE, GNOME, wlroots) as well as
  X11. The `ydotool install` step enables `ydotool.service`; the user also needs
  access to `/dev/uinput` (be in the `input` group or have a uinput udev ACL).
  Install on Arch/CachyOS: `paru -S ydotool`.

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

- `hold_ms` (default 400) — a tone sustained this long fires `secondary`.
- `bridge_ms` (default 200) — debounce buffer + double-tap window. A lone tap
  commits `primary` this long after the tone ends; a second onset within it is a
  double-tap (→ `secondary`). Keep it tight so single taps stay responsive while
  real double-taps still register.

## Permissions / setup gotchas

**macOS (the classic footguns):**

- **Microphone (TCC):** the process needs mic access to open the input device.
  Running `tingtype monitor` / `run` from a terminal triggers the prompt; the
  *terminal app* is the grantee. System Settings → Privacy & Security → Microphone.
- **Accessibility:** `cliclick` posts CGEvents, which requires the process (or its
  parent terminal) under System Settings → Privacy & Security → **Accessibility**.
  Without it, detection works but **no keys land, with no error.** This is the #1
  "why isn't it typing" cause. For the launchd daemon, grant these to the binary
  that runs it (Bun).

**Linux:**

- **`ydotoold` must be running** and able to open `/dev/uinput`. `tingtype install`
  runs `systemctl --user enable --now ydotool.service`; if keys never land, check
  `systemctl --user status ydotool` and that your user can access `/dev/uinput`.
  This is the Linux equivalent of the "detects but doesn't type" footgun.
- The service runs under your **graphical login session** (`default.target`), which
  is what ydotool injection needs. No special microphone permission exists.

## Service management

```bash
tingtype install   # symlink CLI + install & start the service (launchd / systemd --user)
tingtype status    # running? + recent logs
tingtype logs      # tail the log (file on macOS, journald on Linux)
tingtype restart   # pick up config/code changes (no build step)
tingtype stop      # stop the service
```

The same verbs drive **launchd** on macOS and a **systemd user service** on Linux;
`scripts/_common.sh` dispatches per-OS.

The daemon treats a **disconnected input device as a normal state**: if the
interface is unplugged it waits and polls for it to come back; if a live stream
drops it reconnects with backoff. It never crashes on device loss.

## Commands

| Command | Purpose |
| --- | --- |
| `tingtype run` | Start the detect → gesture → keypress pipeline |
| `tingtype monitor` | Live band/concentration/floor readout for tuning (no keypresses) |
| `tingtype devices` | List audio input devices (Core Audio / PulseAudio) |
| `tingtype gen [--out PATH] [--tones a,b,c] [--duration-ms N]` | Synthesize the signature WAV |
| `tingtype test [--wav PATH]` | Run a WAV (or a synthesized chord) through the detector offline |

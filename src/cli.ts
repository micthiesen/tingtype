import { writeFileSync } from "node:fs";
import { Logger } from "@micthiesen/mitools/logging";
import { notify } from "@micthiesen/mitools/pushover";
import { CliclickPresser, type KeyPresser } from "./actions.js";
import { type AppConfig, loadAppConfig } from "./appConfig.js";
import { CaptureSupervisor } from "./audio/capture.js";
import { listInputDevices } from "./audio/devices.js";
import { getConfig, loadConfig } from "./config.js";
import { Detector } from "./dsp/detect.js";
import { synthesizeSignature } from "./dsp/signature.js";
import { encodeWavMono16 } from "./dsp/wav.js";
import { GestureDecoder } from "./gesture.js";

const logger = new Logger("Main");

function usage(): void {
  console.log(`tingtype — the ting types

Usage: tingtype <command> [options]

Commands:
  run [--dry-run]     Start the detection → gesture → keypress daemon
                      (--dry-run logs gestures but fires no keystrokes)
  monitor             Live detector readout for tuning (no keypresses fired)
  devices             List Core Audio input devices
  gen   [opts]        Synthesize the signature WAV to load onto the ting
  test  --wav PATH    Run a WAV through the detector offline and print events

gen options:
  --out PATH          Output path (default: signature.wav)
  --tones a,b,c       Override tones in Hz (default: config tones)
  --duration-ms N     Approx sample duration (default: 1000; snapped for seamless loop)
  --peak P            Sample amplitude 0-1 (default: 0.25; lower = quieter)
  --no-loop           Faded one-shot instead of a seamless loop (offline testing)

Service management (see scripts/): install, start, stop, restart, deploy, status, logs, kill`);
}

/** Build the live pipeline: capture → detect → gesture → keypress. */
function buildPipeline(app: AppConfig, presser: KeyPresser) {
  const detector = new Detector(app.detector);
  const gesture = new GestureDecoder(app.gesture);
  const supervisor = new CaptureSupervisor({
    deviceSubstring: app.audio.inputDevice,
    sampleRate: app.audio.sampleRate,
  });

  gesture.onGesture = (g) => {
    const spec = g === "primary" ? app.actions.primary : app.actions.secondary;
    logger.info(`Gesture ${g} → ${spec}`);
    presser.press(spec);
  };
  detector.onEvent = (e) => gesture.handle(e);
  // Tick every window (present or not) so the bridge timer can commit a primary
  // during silence; presence is passed so the hold timer only accrues while the
  // tone is genuinely on.
  detector.onWindow = (w) => gesture.tick(w.t, w.present);
  supervisor.onSamples = (s) => detector.feed(s);

  return { detector, gesture, supervisor };
}

async function cmdRun(app: AppConfig, dryRun: boolean): Promise<void> {
  const config = getConfig();
  if (config.PUSHOVER_USER && config.PUSHOVER_TOKEN) {
    Logger.onError = ({ title, body }) =>
      notify({ title: `tingtype: ${title}`, message: body }).catch((err) =>
        console.error("Failed to send error notification:", err),
      );
  }

  // In dry-run, decode and log gestures but fire no keystrokes — for tuning the
  // gesture timing on real hardware without keys landing in your apps.
  const presser: KeyPresser = dryRun ? { press: () => {} } : new CliclickPresser();
  const { supervisor } = buildPipeline(app, presser);

  logger.info(
    `${dryRun ? "[DRY RUN — no keystrokes] " : ""}Listening on "${app.audio.inputDevice}" — ` +
      `tones ${app.detector.tones.join("/")} Hz; tap → ${app.actions.primary}, ` +
      `hold(${app.gesture.holdMs}ms)/double-tap → ${app.actions.secondary}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down…`);
    supervisor.stop();
    await Logger.flush();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await supervisor.run();
}

async function cmdMonitor(app: AppConfig): Promise<void> {
  const detector = new Detector(app.detector);
  const supervisor = new CaptureSupervisor({
    deviceSubstring: app.audio.inputDevice,
    sampleRate: app.audio.sampleRate,
  });

  console.log(
    `Monitoring "${app.audio.inputDevice}" — target bins ${detector.targetBins.join("/")} ` +
      `(${app.detector.tones.join("/")} Hz). Tap the ting; Ctrl-C to stop.\n`,
  );

  let lastPrint = 0;
  let lastPresent = false;
  detector.onWindow = (w) => {
    const now = w.t;
    // Always print on a present-state change (so mid-chord dropouts are visible),
    // print every window while the chord is present, and throttle quiet windows.
    const changed = w.present !== lastPresent;
    lastPresent = w.present;
    if (!w.present && !changed && now - lastPrint < 0.05) return;
    lastPrint = now;
    const bands = w.bands.map((b) => fmtDb(b)).join(" ");
    const floors = w.floors.map((f) => (f > 0 ? fmtDb(f) : "auto")).join(" ");
    const flag = w.present ? "  ◀ CHORD" : "";
    console.log(
      `t=${now.toFixed(2)}s  bands[dB]=${bands}  conc=${w.concentration.toFixed(3)}  floor=${floors}${flag}`,
    );
  };
  detector.onEvent = (e) =>
    console.log(`  >>> ${e.type.toUpperCase()} @ ${e.t.toFixed(3)}s`);
  supervisor.onSamples = (s) => detector.feed(s);

  const stop = () => {
    supervisor.stop();
    const suggested = detector.suggestedFloor();
    console.log(
      `\nSuggested noise_floor = [${suggested.map((f) => f.toExponential(2)).join(", ")}]`,
    );
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await supervisor.run();
}

function cmdDevices(): void {
  const devices = listInputDevices();
  if (devices.length === 0) {
    console.log("No Core Audio input devices found.");
    return;
  }
  console.log("Core Audio input devices:");
  for (const d of devices) console.log(`  [${d.index}] ${d.name}`);
}

function cmdGen(app: AppConfig, args: Args): void {
  const out = args.string("out") ?? "signature.wav";

  const tonesArg = args.string("tones");
  const tones = tonesArg ? tonesArg.split(",").map(Number) : app.detector.tones;
  if (tones.length === 0 || tones.some((f) => !Number.isFinite(f) || f <= 0)) {
    throw new Error(
      `--tones must be a comma-separated list of positive numbers, got "${tonesArg}"`,
    );
  }

  const durationMs = args.number("duration-ms") ?? 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error(
      `--duration-ms must be a positive number, got "${args.string("duration-ms")}"`,
    );
  }

  const peak = args.number("peak") ?? 0.25;
  if (!Number.isFinite(peak) || peak <= 0 || peak > 1) {
    throw new Error(`--peak must be in (0, 1], got "${args.string("peak")}"`);
  }
  // Loop by default: the ting plays the sample in hold/loop playmode, so it must
  // tile seamlessly. --no-loop produces a faded one-shot for offline testing.
  const loop = args.string("no-loop") === undefined;

  const result = synthesizeSignature({
    tones,
    durationMs,
    fs: app.audio.sampleRate,
    window: app.detector.window,
    peak,
    loop,
  });
  writeFileSync(out, encodeWavMono16(result.samples, result.sampleRate));

  const actualMs = ((result.samples.length / result.sampleRate) * 1000).toFixed(0);
  console.log(
    `Wrote ${out} (${actualMs}ms, ${result.sampleRate}Hz, 16-bit mono, peak ${peak}` +
      `${loop ? ", seamless loop" : ""}).`,
  );
  console.log("Tones snapped to bin centers:");
  for (const t of result.tones) {
    console.log(`  ${t.requested}Hz → ${t.snapped.toFixed(2)}Hz (bin ${t.bin})`);
  }
  console.log("\nCopy this file to 1.wav/2.wav/3.wav/4.wav on the TINGDISK volume.");
}

async function cmdTest(app: AppConfig, args: Args): Promise<void> {
  const wavPath = args.string("wav");
  let samples: Float32Array;
  let sampleRate = app.audio.sampleRate;

  if (wavPath) {
    const file = Bun.file(wavPath);
    if (!(await file.exists())) throw new Error(`WAV not found: ${wavPath}`);
    const { decodeWav } = await import("./dsp/wav.js");
    const decoded = decodeWav(new Uint8Array(await file.arrayBuffer()));
    samples = decoded.samples;
    sampleRate = decoded.sampleRate;
    console.log(`Loaded ${wavPath} (${samples.length} samples @ ${sampleRate}Hz).`);
  } else {
    const sig = synthesizeSignature({
      tones: app.detector.tones,
      durationMs: 150,
      fs: app.audio.sampleRate,
      window: app.detector.window,
    });
    // Pad with silence so the detector sees a clean onset and release.
    samples = new Float32Array(app.audio.sampleRate);
    samples.set(sig.samples, Math.floor(app.audio.sampleRate * 0.2));
    console.log("No --wav given; testing against a synthesized chord + silence.");
  }

  const detector = new Detector({ ...app.detector, fs: sampleRate });
  let events = 0;
  detector.onEvent = (e) => {
    events++;
    console.log(`  ${e.type.toUpperCase()} @ ${e.t.toFixed(3)}s`);
  };
  detector.feed(samples);
  console.log(events > 0 ? `\nDetected ${events} event(s).` : "\nNo events detected.");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = new Args(rest);

  if (!command || command === "help" || command === "-h" || command === "--help") {
    usage();
    return;
  }

  if (command === "devices") {
    loadConfig();
    cmdDevices();
    return;
  }

  loadConfig();
  const app = loadAppConfig(getConfig().TINGTYPE_CONFIG);

  switch (command) {
    case "run":
      await cmdRun(app, args.string("dry-run") !== undefined);
      break;
    case "monitor":
      await cmdMonitor(app);
      break;
    case "gen":
      cmdGen(app, args);
      break;
    case "test":
      await cmdTest(app, args);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      usage();
      process.exit(1);
  }
}

/** Format a linear power value as dB for the monitor readout. */
function fmtDb(power: number): string {
  if (power <= 0) return "  -inf";
  return (10 * Math.log10(power)).toFixed(1).padStart(6);
}

/** Tiny `--flag value` parser. */
class Args {
  private readonly map = new Map<string, string>();
  constructor(argv: string[]) {
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i];
      if (token.startsWith("--")) {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          this.map.set(key, next);
          i++;
        } else {
          this.map.set(key, "true");
        }
      }
    }
  }
  string(key: string): string | undefined {
    return this.map.get(key);
  }
  number(key: string): number | undefined {
    const v = this.map.get(key);
    return v === undefined ? undefined : Number(v);
  }
}

main().catch((err) => {
  // User-facing CLI errors (bad flags, missing/invalid config) read better as a
  // one-line message than a stack trace; reserve the stack for unexpected faults.
  console.error(`tingtype: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

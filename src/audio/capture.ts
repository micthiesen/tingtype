import { Logger } from "@micthiesen/mitools/logging";
import type { Subprocess } from "bun";
import {
  type AudioInputDevice,
  ffmpegInputArgs,
  listInputDevices,
  parseAlsaDirectSpec,
  resolveDevice,
} from "./devices.js";
import { PcmFramer } from "./pcm.js";

const logger = new Logger("Audio");

export interface CaptureOptions {
  /** Substring matched against input device names/ids (Core Audio or PulseAudio). */
  deviceSubstring: string;
  sampleRate: number;
  ffmpeg?: string;
  /** How often to re-scan for the device while it's missing (ms). */
  pollIntervalMs?: number;
  /** Backoff bounds when a live stream drops (ms). */
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Owns the ffmpeg → PCM pipeline and treats a missing device as a normal state:
 * if the interface is unplugged it waits and polls, and if a live stream drops
 * it reconnects with backoff — never crashing, never spamming error
 * notifications. Emits mono float32 frames (sampleRate, [-1, 1]) to `onSamples`.
 */
export class CaptureSupervisor {
  onSamples: ((samples: Float32Array) => void) | null = null;

  private readonly ffmpeg: string;
  private readonly pollIntervalMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  private proc: Subprocess<"ignore", "pipe", "pipe"> | null = null;
  private stopping = false;
  private loggedWaitingNotice = false;
  private readonly framer = new PcmFramer();

  constructor(private readonly opts: CaptureOptions) {
    this.ffmpeg = opts.ffmpeg ?? "ffmpeg";
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.minBackoffMs = opts.minBackoffMs ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 5000;
  }

  /** Run until {@link stop} is called. Resolves when the supervisor halts. */
  async run(): Promise<void> {
    let backoff = this.minBackoffMs;
    while (!this.stopping) {
      let device: AudioInputDevice | undefined;
      try {
        // An `alsa:<pcm>` spec is used verbatim (a dsnoop/dmix PCM that device
        // enumeration won't list); everything else resolves by substring.
        device =
          parseAlsaDirectSpec(this.opts.deviceSubstring) ??
          resolveDevice(this.opts.deviceSubstring, listInputDevices(this.ffmpeg));
      } catch (err) {
        // Enumeration tool unavailable (pactl/ffmpeg missing or not running).
        // Treat as device-absent and keep polling — the supervisor must never
        // crash on a transient or missing backend.
        if (!this.loggedWaitingNotice) {
          this.loggedWaitingNotice = true;
          logger.warn(`Device enumeration failed (${String(err)}) — retrying…`);
        }
        await delay(this.pollIntervalMs);
        continue;
      }
      if (!device) {
        if (!this.loggedWaitingNotice) {
          this.loggedWaitingNotice = true;
          logger.warn(
            `Input device matching "${this.opts.deviceSubstring}" not found — waiting for it to (re)connect…`,
          );
        }
        await delay(this.pollIntervalMs);
        continue;
      }
      if (this.loggedWaitingNotice) {
        this.loggedWaitingNotice = false;
        logger.info(`Input device connected: ${device.name}`);
      }

      const streamed = await this.streamFrom(device);
      if (this.stopping) break;

      if (streamed) {
        backoff = this.minBackoffMs; // a healthy stream resets the backoff
        logger.warn(
          "Audio stream ended (device asleep or disconnected?). Reconnecting…",
        );
      } else {
        backoff = Math.min(backoff * 2, this.maxBackoffMs);
      }
      await delay(backoff);
    }
    logger.info("Capture stopped.");
  }

  stop(): void {
    this.stopping = true;
    this.proc?.kill();
  }

  /** Stream until ffmpeg exits. Returns true if any audio was received. */
  private async streamFrom(device: AudioInputDevice): Promise<boolean> {
    this.framer.reset();
    let received = false;

    try {
      this.proc = Bun.spawn(
        [
          this.ffmpeg,
          "-hide_banner",
          "-loglevel",
          "error",
          // Low-latency input: a raw capture stream needs no probing, and
          // nobuffer stops ffmpeg from accumulating frames before forwarding.
          "-fflags",
          "nobuffer",
          "-probesize",
          "32",
          "-analyzeduration",
          "0",
          ...ffmpegInputArgs(device),
          "-ac",
          "1",
          "-ar",
          String(this.opts.sampleRate),
          "-f",
          "f32le",
          // Flush every packet to the pipe immediately. Otherwise ffmpeg fills a
          // ~32KB output buffer (~170ms @ 48k mono f32) before the detector sees
          // a single sample — the dominant, and easily avoidable, capture latency.
          "-flush_packets",
          "1",
          "-",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
    } catch (err) {
      logger.error("Failed to spawn ffmpeg (is it installed?)", err);
      return false;
    }

    // Drain stderr concurrently — an unconsumed full pipe would stall ffmpeg
    // (and thus stdout) indefinitely. We also use it to report the exit reason.
    const stderrText = drainText(this.proc.stderr);

    try {
      for await (const chunk of this.proc.stdout) {
        received = true;
        const frame = this.framer.push(chunk);
        if (frame.length > 0) this.onSamples?.(frame);
      }
    } catch (err) {
      if (!this.stopping) logger.warn(`Audio read error: ${String(err)}`);
    }

    await this.proc.exited;
    if (!this.stopping && !received) {
      const stderr = (await stderrText).trim();
      if (stderr) logger.warn(`ffmpeg: ${stderr}`);
    }
    this.proc = null;
    return received;
  }
}

/** Read a stream to completion as text; never rejects (drains even on error). */
async function drainText(stream: ReadableStream<Uint8Array>): Promise<string> {
  try {
    return await new Response(stream).text();
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { Logger } from "@micthiesen/mitools/logging";
import type { Subprocess } from "bun";
import { listInputDevices, resolveDevice } from "./devices.js";

const logger = new Logger("Audio");

export interface CaptureOptions {
  /** Substring matched against Core Audio input device names. */
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
  private waiting = false; // whether we've already logged the "waiting" notice
  private leftover: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

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
      const device = resolveDevice(
        this.opts.deviceSubstring,
        listInputDevices(this.ffmpeg),
      );
      if (!device) {
        if (!this.waiting) {
          this.waiting = true;
          logger.warn(
            `Input device matching "${this.opts.deviceSubstring}" not found — waiting for it to (re)connect…`,
          );
        }
        await delay(this.pollIntervalMs);
        continue;
      }
      if (this.waiting) {
        this.waiting = false;
        logger.info(`Input device connected: ${device.name}`);
      }

      const streamed = await this.streamFrom(device.name);
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
  private async streamFrom(deviceName: string): Promise<boolean> {
    this.leftover = new Uint8Array(0);
    let received = false;

    try {
      this.proc = Bun.spawn(
        [
          this.ffmpeg,
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "avfoundation",
          "-i",
          `:${deviceName}`,
          "-ac",
          "1",
          "-ar",
          String(this.opts.sampleRate),
          "-f",
          "f32le",
          "-",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
    } catch (err) {
      logger.error("Failed to spawn ffmpeg (is it installed?)", err);
      return false;
    }

    try {
      for await (const chunk of this.proc.stdout) {
        received = true;
        const frame = this.decode(chunk as Uint8Array);
        if (frame.length > 0) this.onSamples?.(frame);
      }
    } catch (err) {
      if (!this.stopping) logger.warn(`Audio read error: ${String(err)}`);
    }

    const code = await this.proc.exited;
    if (!this.stopping && !received) {
      const stderr = await new Response(this.proc.stderr).text();
      if (stderr.trim()) logger.warn(`ffmpeg: ${stderr.trim()}`);
    }
    void code;
    this.proc = null;
    return received;
  }

  /** Decode little-endian float32 bytes, carrying any partial trailing sample. */
  private decode(chunk: Uint8Array<ArrayBufferLike>): Float32Array {
    const buf = this.leftover.length === 0 ? chunk : concat(this.leftover, chunk);
    const sampleCount = buf.byteLength >> 2; // 4 bytes per float
    const usableBytes = sampleCount << 2;
    this.leftover = buf.subarray(usableBytes);

    const out = new Float32Array(sampleCount);
    const view = new DataView(buf.buffer, buf.byteOffset, usableBytes);
    for (let i = 0; i < sampleCount; i++) out[i] = view.getFloat32(i << 2, true);
    return out;
  }
}

function concat(
  a: Uint8Array<ArrayBufferLike>,
  b: Uint8Array<ArrayBufferLike>,
): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { existsSync, readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { parseKeySpec } from "./actions.js";
import type { DetectorOptions } from "./dsp/detect.js";
import { isPowerOfTwo } from "./dsp/fft.js";
import type { GestureOptions } from "./gesture.js";

/** Raw TOML shape (snake_case), every field defaulted so a bare file still boots. */
const rawSchema = z.object({
  audio: z
    .object({
      input_device: z.string().default("CUBILUX HLMS-C4 Line IN"),
      samplerate: z.number().int().positive().default(48000),
    })
    .prefault({}),
  detector: z
    .object({
      tones: z.array(z.number().positive()).min(1).default([2016, 2484, 3141]),
      window: z.number().int().positive().default(1024),
      hop: z.number().int().positive().default(256),
      k_consecutive: z.number().int().positive().default(4),
      concentration_threshold: z.number().min(0).max(1).default(0.5),
      per_band_min_share: z.number().min(0).max(1).default(0.08),
      noise_floor: z.array(z.number().min(0)).default([0, 0, 0]),
      release_windows: z.number().int().positive().default(2),
      refractory_ms: z.number().min(0).default(200),
      max_chord_ms: z.number().positive().default(5000),
    })
    .prefault({}),
  gesture: z
    .object({
      hold_ms: z.number().positive().default(400),
      refractory_ms: z.number().min(0).default(250),
    })
    .prefault({}),
  actions: z
    .object({
      tap: z.string().default("ctrl+opt+space"),
      hold: z.string().default("return"),
    })
    .prefault({}),
});

export interface AppConfig {
  audio: { inputDevice: string; sampleRate: number };
  detector: DetectorOptions;
  gesture: GestureOptions;
  actions: { tap: string; hold: string };
}

/** Validate a parsed TOML object and normalize it into a typed {@link AppConfig}. */
export function normalizeAppConfig(raw: unknown): AppConfig {
  const c = rawSchema.parse(raw ?? {});

  if (!isPowerOfTwo(c.detector.window)) {
    throw new Error(`detector.window must be a power of two, got ${c.detector.window}`);
  }
  if (c.detector.hop > c.detector.window) {
    throw new Error("detector.hop must be <= detector.window");
  }

  // Fail fast on a bad keyspec at load time rather than on the first gesture.
  for (const [name, spec] of [
    ["actions.tap", c.actions.tap],
    ["actions.hold", c.actions.hold],
  ] as const) {
    try {
      parseKeySpec(spec);
    } catch (err) {
      throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Match the floor array to the tone count (pad with 0 => auto-estimate).
  const floors = c.detector.tones.map((_, i) => c.detector.noise_floor[i] ?? 0);

  return {
    audio: { inputDevice: c.audio.input_device, sampleRate: c.audio.samplerate },
    detector: {
      fs: c.audio.samplerate,
      window: c.detector.window,
      hop: c.detector.hop,
      tones: c.detector.tones,
      kConsecutive: c.detector.k_consecutive,
      concentrationThreshold: c.detector.concentration_threshold,
      perBandMinShare: c.detector.per_band_min_share,
      noiseFloor: floors,
      releaseWindows: c.detector.release_windows,
      refractoryMs: c.detector.refractory_ms,
      maxChordMs: c.detector.max_chord_ms,
    },
    gesture: { holdMs: c.gesture.hold_ms, refractoryMs: c.gesture.refractory_ms },
    actions: { tap: c.actions.tap, hold: c.actions.hold },
  };
}

/** Load and validate the tuning config; falls back to built-in defaults if absent. */
export function loadAppConfig(path: string): AppConfig {
  if (!existsSync(path)) {
    return normalizeAppConfig({});
  }
  let raw: unknown;
  try {
    raw = parseToml(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to parse config ${path}: ${err instanceof Error ? err.message : err}`,
    );
  }
  try {
    return normalizeAppConfig(raw);
  } catch (err) {
    throw new Error(
      `Invalid config ${path}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

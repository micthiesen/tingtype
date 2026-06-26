import { binToFreq, freqToBin } from "./goertzel.js";

export interface SignatureOptions {
  tones: number[];
  durationMs: number;
  fs: number;
  /** FFT window the detector uses; tones are snapped to its bin centers. */
  window: number;
  /** Raised-cosine attack/release in ms (anti-click). Forced to 0 when looping. */
  fadeMs?: number;
  /** Peak amplitude after normalization (0.5 ~= -6 dBFS). */
  peak?: number;
  /**
   * Make the sample loop seamlessly for `hold`/loop playmode: snap the length to
   * a whole number of `window`s (so every bin-snapped tone closes an integer
   * number of cycles at the loop point) and drop the edge fades. All tones start
   * at phase 0, so the loop seam — and the first sample — are click-free.
   */
  loop?: boolean;
}

export interface SnappedTone {
  requested: number;
  snapped: number;
  bin: number;
}

export interface SignatureResult {
  samples: Float32Array;
  sampleRate: number;
  tones: SnappedTone[];
}

/**
 * Synthesize the signature chord: equal-amplitude sines at bin-snapped tones,
 * with a short raised-cosine fade, normalized to `peak`. The detector listens
 * for exactly these bins, so authored and matched can never drift.
 */
export function synthesizeSignature(opts: SignatureOptions): SignatureResult {
  const { tones, durationMs, fs, window } = opts;
  const loop = opts.loop ?? false;
  const fadeMs = loop ? 0 : (opts.fadeMs ?? 5);
  const peak = opts.peak ?? 0.5;

  const snapped: SnappedTone[] = tones.map((requested) => {
    const bin = freqToBin(requested, fs, window);
    return { requested, snapped: binToFreq(bin, fs, window), bin };
  });

  let length = Math.max(1, Math.round((durationMs / 1000) * fs));
  if (loop) length = Math.max(window, Math.round(length / window) * window);
  const fadeLen = Math.min(Math.floor(length / 2), Math.round((fadeMs / 1000) * fs));
  const raw = new Float64Array(length);

  for (const { snapped: freq } of snapped) {
    const omega = (2 * Math.PI * freq) / fs;
    for (let n = 0; n < length; n++) raw[n] += Math.sin(omega * n);
  }

  // Raised-cosine attack/release envelope.
  for (let n = 0; n < fadeLen; n++) {
    const g = 0.5 * (1 - Math.cos((Math.PI * n) / fadeLen));
    raw[n] *= g;
    raw[length - 1 - n] *= g;
  }

  let maxAbs = 0;
  for (let n = 0; n < length; n++) maxAbs = Math.max(maxAbs, Math.abs(raw[n]));
  const scale = maxAbs > 0 ? peak / maxAbs : 0;

  const samples = new Float32Array(length);
  for (let n = 0; n < length; n++) samples[n] = raw[n] * scale;

  return { samples, sampleRate: fs, tones: snapped };
}

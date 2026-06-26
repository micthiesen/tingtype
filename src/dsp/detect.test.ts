import { describe, expect, it } from "bun:test";
import { type DetectionEvent, Detector } from "./detect.js";
import { FS, detectorOpts as opts, TONES, WINDOW } from "./fixtures.js";
import { synthesizeSignature } from "./signature.js";

function run(samples: Float32Array, o = opts()): DetectionEvent[] {
  const events: DetectionEvent[] = [];
  const d = new Detector(o);
  d.onEvent = (e) => events.push(e);
  d.feed(samples);
  return events;
}

function pureTone(freq: number, durationS: number, amp = 0.5): Float32Array {
  const n = Math.round(durationS * FS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS);
  return out;
}

function whiteNoise(durationS: number, amp = 0.3, seed = 1): Float32Array {
  // Deterministic LCG so the test is reproducible.
  const n = Math.round(durationS * FS);
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (1664525 * s + 1013904223) >>> 0;
    out[i] = ((s / 0xffffffff) * 2 - 1) * amp;
  }
  return out;
}

describe("Detector false-positive rejection", () => {
  it("does not fire on silence", () => {
    expect(run(new Float32Array(FS))).toEqual([]);
  });

  it("does not fire on broadband white noise", () => {
    expect(run(whiteNoise(1.0))).toEqual([]);
  });

  it("does not fire on a single sustained tone (needs the whole chord)", () => {
    expect(run(pureTone(TONES[0], 0.6))).toEqual([]);
  });

  it("does not fire on two of the three tones", () => {
    const n = Math.round(0.6 * FS);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] =
        0.4 * Math.sin((2 * Math.PI * TONES[0] * i) / FS) +
        0.4 * Math.sin((2 * Math.PI * TONES[1] * i) / FS);
    }
    expect(run(out)).toEqual([]);
  });
});

describe("Detector debounce / refractory", () => {
  it("collapses one chord into a single onset even with brief dropouts", () => {
    const sig = synthesizeSignature({
      tones: TONES,
      durationMs: 300,
      fs: FS,
      window: WINDOW,
    });
    const samples = new Float32Array(FS);
    samples.set(sig.samples, Math.floor(FS * 0.2));
    const events = run(samples);
    expect(events.filter((e) => e.type === "onset")).toHaveLength(1);
  });

  it("separates two distinct chords into two onsets", () => {
    const sig = synthesizeSignature({
      tones: TONES,
      durationMs: 150,
      fs: FS,
      window: WINDOW,
    });
    const samples = new Float32Array(Math.round(FS * 1.5));
    samples.set(sig.samples, Math.floor(FS * 0.2));
    samples.set(sig.samples, Math.floor(FS * 0.9)); // 2nd chord well past refractory
    const onsets = run(samples).filter((e) => e.type === "onset");
    expect(onsets).toHaveLength(2);
  });

  it("suppresses a second chord that lands within the refractory window", () => {
    const sig = synthesizeSignature({
      tones: TONES,
      durationMs: 120,
      fs: FS,
      window: WINDOW,
    });
    const samples = new Float32Array(FS);
    samples.set(sig.samples, Math.floor(FS * 0.2)); // chord #1: 0.20–0.32s
    samples.set(sig.samples, Math.floor(FS * 0.4)); // chord #2: 0.40s, within 200ms refractory of release
    const onsets = run(samples, opts({ refractoryMs: 400 })).filter(
      (e) => e.type === "onset",
    );
    expect(onsets).toHaveLength(1);
  });
});

describe("Detector noise floor", () => {
  it("suppresses an otherwise-present chord when the configured floor is above its band power", () => {
    const sig = synthesizeSignature({
      tones: TONES,
      durationMs: 200,
      fs: FS,
      window: WINDOW,
    });
    const samples = new Float32Array(FS);
    samples.set(sig.samples, Math.floor(FS * 0.3));
    // A floor far above any real band power blocks every tone.
    const events = run(samples, opts({ noiseFloor: [1e9, 1e9, 1e9] }));
    expect(events).toEqual([]);
  });
});

describe("Detector watchdog", () => {
  it("force-releases a chord that stays present past maxChordMs", () => {
    // A continuous chord that never stops: the watchdog must emit a release.
    const sig = synthesizeSignature({
      tones: TONES,
      durationMs: 2000,
      fs: FS,
      window: WINDOW,
    });
    const events = run(sig.samples, opts({ maxChordMs: 500, refractoryMs: 0 }));
    expect(events[0]?.type).toBe("onset");
    expect(events.some((e) => e.type === "release")).toBe(true);
  });
});

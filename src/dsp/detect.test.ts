import { describe, expect, it } from "bun:test";
import { type DetectionEvent, Detector, type DetectorOptions } from "./detect.js";
import { synthesizeSignature } from "./signature.js";

const FS = 48000;
const WINDOW = 1024;
const TONES = [2016, 2484, 3141];

function opts(overrides: Partial<DetectorOptions> = {}): DetectorOptions {
  return {
    fs: FS,
    window: WINDOW,
    hop: 256,
    tones: TONES,
    kConsecutive: 4,
    concentrationThreshold: 0.5,
    perBandMinShare: 0.08,
    noiseFloor: [0, 0, 0],
    releaseWindows: 2,
    refractoryMs: 200,
    ...overrides,
  };
}

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
});

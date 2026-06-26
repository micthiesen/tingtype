import { describe, expect, it } from "bun:test";
import { type DetectionEvent, Detector } from "./detect.js";
import { detectorOpts, FS, TONES, WINDOW } from "./fixtures.js";
import { freqToBin, goertzelPower, hannWindow } from "./goertzel.js";
import { synthesizeSignature } from "./signature.js";

describe("synthesizeSignature", () => {
  it("snaps tones to exact FFT bin centers", () => {
    const { tones } = synthesizeSignature({
      tones: TONES,
      durationMs: 150,
      fs: FS,
      window: WINDOW,
    });
    for (const t of tones) {
      expect(t.bin).toBe(freqToBin(t.requested, FS, WINDOW));
      expect(t.snapped).toBeCloseTo((t.bin * FS) / WINDOW, 6);
    }
  });

  it("normalizes to the requested peak amplitude", () => {
    const { samples } = synthesizeSignature({
      tones: TONES,
      durationMs: 150,
      fs: FS,
      window: WINDOW,
      peak: 0.5,
    });
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeCloseTo(0.5, 2);
  });

  it("parks energy on the intended Goertzel bins, not their neighbors", () => {
    const { samples, tones } = synthesizeSignature({
      tones: TONES,
      durationMs: 150,
      fs: FS,
      window: WINDOW,
    });
    // Window a steady mid-sample block.
    const start = 2000;
    const hann = hannWindow(WINDOW);
    const block = new Float64Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) block[i] = samples[start + i] * hann[i];

    for (const t of tones) {
      const onBin = goertzelPower(block, t.bin);
      const offBin = goertzelPower(block, t.bin + 3);
      expect(onBin).toBeGreaterThan(offBin * 50);
    }
  });
});

describe("Detector on the generated signature", () => {
  it("fires exactly one onset and one release for a chord between silence", () => {
    const sig = synthesizeSignature({
      tones: TONES,
      durationMs: 150,
      fs: FS,
      window: WINDOW,
    });
    const samples = new Float32Array(FS); // 1s of silence
    samples.set(sig.samples, Math.floor(FS * 0.3));

    const events: DetectionEvent[] = [];
    const detector = new Detector(detectorOpts());
    detector.onEvent = (e) => events.push(e);
    detector.feed(samples);

    expect(events.map((e) => e.type)).toEqual(["onset", "release"]);
    // Onset lands near the chord start (~0.3s).
    expect(events[0].t).toBeGreaterThan(0.28);
    expect(events[0].t).toBeLessThan(0.36);
  });
});

import { describe, expect, it } from "bun:test";
import { FftScratch, fftInPlace, isPowerOfTwo, powerSpectrum } from "./fft.js";

describe("isPowerOfTwo", () => {
  it("classifies correctly", () => {
    for (const n of [1, 2, 4, 8, 1024]) expect(isPowerOfTwo(n)).toBe(true);
    for (const n of [0, 3, 6, 1000, -4]) expect(isPowerOfTwo(n)).toBe(false);
  });
});

describe("fftInPlace", () => {
  it("transforms a DC signal into energy at bin 0 only", () => {
    const n = 8;
    const re = new Float64Array(n).fill(1);
    const im = new Float64Array(n);
    fftInPlace(re, im);
    expect(re[0]).toBeCloseTo(n, 9); // DC = sum
    for (let k = 1; k < n; k++) {
      expect(Math.hypot(re[k], im[k])).toBeCloseTo(0, 9);
    }
  });

  it("places a pure cosine's energy on its bin (and the mirror bin)", () => {
    const n = 16;
    const k0 = 3;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * k0 * i) / n);
    fftInPlace(re, im);
    const power = Array.from({ length: n }, (_, k) => re[k] * re[k] + im[k] * im[k]);
    for (let k = 0; k < n; k++) {
      if (k === k0 || k === n - k0) expect(power[k]).toBeGreaterThan(1);
      else expect(power[k]).toBeCloseTo(0, 6);
    }
  });

  it("satisfies Parseval: sum|X|^2 == n * sum|x|^2", () => {
    const n = 16;
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i) + 0.3 * i);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fftInPlace(re, im);
    let specEnergy = 0;
    for (let k = 0; k < n; k++) specEnergy += re[k] * re[k] + im[k] * im[k];
    let timeEnergy = 0;
    for (const v of x) timeEnergy += v * v;
    expect(specEnergy).toBeCloseTo(n * timeEnergy, 6);
  });
});

describe("FftScratch", () => {
  it("matches powerSpectrum and rejects non-power-of-two sizes", () => {
    expect(() => new FftScratch(1000)).toThrow(/power of two/);
    const n = 8;
    const x = Float64Array.from({ length: n }, (_, i) =>
      Math.cos((2 * Math.PI * 2 * i) / n),
    );
    const scratch = new FftScratch(n);
    scratch.compute(x);
    const direct = powerSpectrum(x);
    for (let k = 0; k <= n / 2; k++) expect(scratch.power[k]).toBeCloseTo(direct[k], 9);
  });
});

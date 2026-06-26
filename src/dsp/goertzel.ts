/**
 * Goertzel single-bin power. Kept as the spec's reference path and used by tests
 * to assert that generated tones land on their intended bins. The live detector
 * plucks the same bins from the per-hop FFT (see {@link ./detect.ts}).
 */
export function goertzelPower(x: ArrayLike<number>, k: number): number {
  const n = x.length;
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/** Nearest FFT bin index for a frequency. */
export function freqToBin(freq: number, fs: number, n: number): number {
  return Math.round((n * freq) / fs);
}

/** Center frequency of an FFT bin. */
export function binToFreq(k: number, fs: number, n: number): number {
  return (k * fs) / n;
}

/** Symmetric Hann window of length `n` (denominator n-1). */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

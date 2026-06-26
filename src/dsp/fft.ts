/**
 * Minimal radix-2 FFT used by the detector. The bank is small, but we compute a
 * full FFT per hop anyway to get the one-sided total energy (for `concentration`)
 * and pluck the target bins from the same transform — cheaper and guaranteed
 * consistent with the band powers.
 */

/** In-place iterative Cooley–Tukey FFT. `re`/`im` length must be a power of two. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wpr = Math.cos(ang);
    const wpi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nwr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr;
        wr = nwr;
      }
    }
  }
}

/** Power is true iff `n` is a positive power of two. */
export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * One-sided power spectrum |X[k]|^2 for k in [0, n/2] of a real signal.
 * Allocates; the detector uses {@link FftScratch} on the hot path instead.
 */
export function powerSpectrum(samples: ArrayLike<number>): Float64Array {
  const n = samples.length;
  const re = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[i];
  const im = new Float64Array(n);
  fftInPlace(re, im);
  const half = n >> 1;
  const power = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return power;
}

/** Reusable FFT buffers so per-hop analysis stays allocation-free. */
export class FftScratch {
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  readonly power: Float64Array;

  constructor(readonly n: number) {
    if (!isPowerOfTwo(n)) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.power = new Float64Array((n >> 1) + 1);
  }

  /** Transform `windowed` (length n) and fill `this.power` with the one-sided spectrum. */
  compute(windowed: Float64Array): void {
    this.re.set(windowed);
    this.im.fill(0);
    fftInPlace(this.re, this.im);
    const half = this.n >> 1;
    for (let k = 0; k <= half; k++) {
      this.power[k] = this.re[k] * this.re[k] + this.im[k] * this.im[k];
    }
  }
}

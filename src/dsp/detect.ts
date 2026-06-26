import { FftScratch, isPowerOfTwo } from "./fft.js";
import { freqToBin, hannWindow } from "./goertzel.js";

export interface DetectorOptions {
  fs: number;
  /** FFT window size in samples (power of two). */
  window: number;
  /** Analysis stride in samples. */
  hop: number;
  /** Target tone frequencies in Hz (snapped to bins internally). */
  tones: number[];
  /** Hot windows required before emitting an onset. */
  kConsecutive: number;
  /** Minimum fraction of one-sided spectral energy in the target bins. */
  concentrationThreshold: number;
  /**
   * Minimum share of one-sided energy each individual tone must carry. Enforces
   * that the whole chord is present (not just one sustained tone) independent of
   * the noise floor, so it holds even before the floor estimate warms up.
   */
  perBandMinShare: number;
  /** Per-band power floor; entries <= 0 are auto-estimated at runtime. */
  noiseFloor: number[];
  /** Cold windows required to close a chord and emit a release. */
  releaseWindows: number;
  /** Ignore new onsets for this long (ms) after a release. */
  refractoryMs: number;
}

/** Per-window analysis snapshot, surfaced to `monitor` for tuning. */
export interface WindowResult {
  /** Sample-based timestamp (seconds) of the window's trailing edge. */
  t: number;
  /** Per-tone power |X[k]|^2. */
  bands: number[];
  /** Fraction of one-sided spectral energy parked in the target bins. */
  concentration: number;
  /** Effective per-band floor used for the decision this window. */
  floors: number[];
  /** Whether the chord is considered present this window. */
  present: boolean;
}

export type DetectionEvent =
  | { type: "onset"; t: number }
  | { type: "release"; t: number };

const EPS = 1e-12;

/**
 * Tracks recent per-band power during clearly-non-chord windows and offers a
 * suggested floor (median x headroom). Bounded ring per band.
 */
class NoiseFloorEstimator {
  private readonly history: number[][];
  private readonly cursor: number[];
  private readonly filled: number[];
  private readonly capacity = 256;

  constructor(private readonly bands: number) {
    this.history = Array.from({ length: bands }, () =>
      new Array<number>(this.capacity).fill(0),
    );
    this.cursor = new Array<number>(bands).fill(0);
    this.filled = new Array<number>(bands).fill(0);
  }

  observe(bandPowers: number[]): void {
    for (let i = 0; i < this.bands; i++) {
      this.history[i][this.cursor[i]] = bandPowers[i];
      this.cursor[i] = (this.cursor[i] + 1) % this.capacity;
      if (this.filled[i] < this.capacity) this.filled[i]++;
    }
  }

  /** Median x headroom per band; 0 until enough samples are gathered. */
  suggest(headroom = 6): number[] {
    return Array.from({ length: this.bands }, (_, i) => {
      const count = this.filled[i];
      if (count < 32) return 0;
      const slice = this.history[i].slice(0, count).sort((a, b) => a - b);
      const median = slice[slice.length >> 1];
      return median * headroom;
    });
  }
}

/**
 * Goertzel/FFT chord detector. Feed it mono PCM via {@link feed}; it emits
 * de-bounced onset/release events and per-window snapshots. Pure and
 * synchronous — drive it from synthesized buffers in tests with no hardware.
 */
export class Detector {
  onEvent: ((event: DetectionEvent) => void) | null = null;
  onWindow: ((result: WindowResult) => void) | null = null;

  private readonly bins: number[];
  private readonly hann: Float64Array;
  private readonly fft: FftScratch;
  private readonly scratch: Float64Array;
  private readonly ring: Float64Array;
  private readonly floor: NoiseFloorEstimator;

  private writeIdx = 0;
  private total = 0;
  private sinceHop = 0;

  private hotStreak = 0;
  private coldStreak = 0;
  private active = false;
  private refractoryUntil = Number.NEGATIVE_INFINITY;

  constructor(private readonly opts: DetectorOptions) {
    if (!isPowerOfTwo(opts.window)) {
      throw new Error(`detector.window must be a power of two, got ${opts.window}`);
    }
    this.bins = opts.tones.map((f) => freqToBin(f, opts.fs, opts.window));
    this.hann = hannWindow(opts.window);
    this.fft = new FftScratch(opts.window);
    this.scratch = new Float64Array(opts.window);
    this.ring = new Float64Array(opts.window);
    this.floor = new NoiseFloorEstimator(opts.tones.length);
  }

  /** Bin index per configured tone (for monitor display / tests). */
  get targetBins(): number[] {
    return [...this.bins];
  }

  /** Current auto-estimated floor suggestion (for monitor). */
  suggestedFloor(): number[] {
    return this.floor.suggest();
  }

  feed(samples: ArrayLike<number>): void {
    const { window, hop } = this.opts;
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.writeIdx] = samples[i];
      this.writeIdx = (this.writeIdx + 1) % window;
      this.total++;
      this.sinceHop++;
      if (this.total >= window && this.sinceHop >= hop) {
        this.sinceHop = 0;
        this.processWindow();
      }
    }
  }

  private processWindow(): void {
    const { window, hop, fs, concentrationThreshold, noiseFloor } = this.opts;

    // Extract the window oldest-to-newest and apply the Hann taper.
    for (let i = 0; i < window; i++) {
      this.scratch[i] = this.ring[(this.writeIdx + i) % window] * this.hann[i];
    }
    this.fft.compute(this.scratch);
    const power = this.fft.power;

    const bands = this.bins.map((k) => power[k]);
    let total = 0;
    for (let k = 0; k < power.length; k++) total += power[k];
    let band = 0;
    for (const p of bands) band += p;
    const concentration = band / (total + EPS);

    const suggested = this.floor.suggest();
    const floors = noiseFloor.map((configured, i) =>
      configured > 0 ? configured : (suggested[i] ?? 0),
    );

    const minBand = total * this.opts.perBandMinShare;
    const allTonesPresent = bands.every((p, i) => p > floors[i] && p >= minBand);
    const present = concentration > concentrationThreshold && allTonesPresent;

    // Learn the floor only from windows that clearly are not the chord.
    if (concentration < concentrationThreshold * 0.5) {
      this.floor.observe(bands);
    }

    const t = this.total / fs;
    this.onWindow?.({ t, bands, concentration, floors, present });
    this.runStateMachine(present, t, hop, fs);
  }

  private runStateMachine(present: boolean, t: number, hop: number, fs: number): void {
    const { kConsecutive, releaseWindows, refractoryMs } = this.opts;
    if (present) {
      this.hotStreak++;
      this.coldStreak = 0;
      if (!this.active && this.hotStreak >= kConsecutive && t >= this.refractoryUntil) {
        this.active = true;
        const onsetT = t - ((kConsecutive - 1) * hop) / fs;
        this.onEvent?.({ type: "onset", t: onsetT });
      }
    } else {
      this.coldStreak++;
      this.hotStreak = 0;
      if (this.active && this.coldStreak >= releaseWindows) {
        this.active = false;
        this.refractoryUntil = t + refractoryMs / 1000;
        this.onEvent?.({ type: "release", t });
      }
    }
  }
}

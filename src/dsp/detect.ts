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
  /** Safety watchdog: force a release if a chord stays present longer than this (ms). */
  maxChordMs: number;
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
 * FFT chord detector. Feed it mono PCM via {@link feed}; it emits de-bounced
 * onset/release events and per-window snapshots. Pure and synchronous — drive it
 * from synthesized buffers in tests with no hardware.
 *
 * The per-window snapshot passed to {@link onWindow} is a single reused object;
 * a synchronous consumer (the monitor) may read it but must not retain it.
 */
export class Detector {
  onEvent: ((event: DetectionEvent) => void) | null = null;
  onWindow: ((result: WindowResult) => void) | null = null;

  private readonly bins: number[];
  private readonly hann: Float64Array;
  private readonly fft: FftScratch;
  private readonly scratch: Float64Array;
  private readonly ring: Float64Array;
  private readonly mask: number;
  /** Lowest FFT bin counted in `total`; excludes DC, mains hum, and rumble. */
  private readonly lowCutBin: number;
  private readonly floor: NoiseFloorEstimator;
  private readonly hasAutoFloor: boolean;

  // Reused per-window buffers (avoid hot-path allocation at ~188 Hz).
  private readonly bands: number[];
  private readonly floors: number[];
  private readonly result: WindowResult;

  private writeIdx = 0;
  private total = 0;
  private sinceHop = 0;

  private hotStreak = 0;
  private coldStreak = 0;
  private active = false;
  private activeOnsetT = 0;
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
    this.mask = opts.window - 1;
    this.lowCutBin = Math.max(1, freqToBin(200, opts.fs, opts.window));
    this.floor = new NoiseFloorEstimator(opts.tones.length);
    this.hasAutoFloor = opts.noiseFloor.some((f) => f <= 0);
    this.bands = new Array<number>(opts.tones.length).fill(0);
    this.floors = new Array<number>(opts.tones.length).fill(0);
    this.result = {
      t: 0,
      bands: this.bands,
      concentration: 0,
      floors: this.floors,
      present: false,
    };
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
      this.writeIdx = (this.writeIdx + 1) & this.mask;
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
      this.scratch[i] = this.ring[(this.writeIdx + i) & this.mask] * this.hann[i];
    }
    this.fft.compute(this.scratch);
    const power = this.fft.power;

    // Total over the audio band only — excluding DC/hum/rumble below lowCutBin,
    // which would otherwise inflate the denominator and depress `concentration`
    // on a real line input (synthetic test signals are DC-free, so this matters
    // only on hardware).
    let totalEnergy = 0;
    for (let k = this.lowCutBin; k < power.length; k++) totalEnergy += power[k];
    let bandEnergy = 0;
    for (let i = 0; i < this.bins.length; i++) {
      const p = power[this.bins[i]];
      this.bands[i] = p;
      bandEnergy += p;
    }
    const concentration = bandEnergy / (totalEnergy + EPS);

    // Only run the (sorting) floor estimate when a band is actually auto-floored.
    const suggested = this.hasAutoFloor ? this.floor.suggest() : null;
    for (let i = 0; i < noiseFloor.length; i++) {
      this.floors[i] = noiseFloor[i] > 0 ? noiseFloor[i] : (suggested?.[i] ?? 0);
    }

    const minBand = totalEnergy * this.opts.perBandMinShare;
    let allTonesPresent = true;
    for (let i = 0; i < this.bands.length; i++) {
      if (this.bands[i] <= this.floors[i] || this.bands[i] < minBand) {
        allTonesPresent = false;
        break;
      }
    }
    const present = concentration > concentrationThreshold && allTonesPresent;

    // Learn the floor only from windows that clearly are not the chord.
    if (this.hasAutoFloor && concentration < concentrationThreshold * 0.5) {
      this.floor.observe(this.bands);
    }

    const t = this.total / fs;
    if (this.onWindow) {
      this.result.t = t;
      this.result.concentration = concentration;
      this.result.present = present;
      this.onWindow(this.result);
    }
    this.runStateMachine(present, t, hop, fs);
  }

  private runStateMachine(present: boolean, t: number, hop: number, fs: number): void {
    const { kConsecutive, releaseWindows, refractoryMs, maxChordMs } = this.opts;
    if (present) {
      this.hotStreak++;
      this.coldStreak = 0;
      if (!this.active && this.hotStreak >= kConsecutive && t >= this.refractoryUntil) {
        this.active = true;
        this.activeOnsetT = t - ((kConsecutive - 1) * hop) / fs;
        this.onEvent?.({ type: "onset", t: this.activeOnsetT });
      } else if (this.active && t - this.activeOnsetT > maxChordMs / 1000) {
        // Watchdog: a chord stuck "present" forever would otherwise wedge the
        // gesture decoder. Force a release so the pipeline self-heals.
        this.closeChord(t, refractoryMs);
      }
    } else {
      this.coldStreak++;
      this.hotStreak = 0;
      if (this.active && this.coldStreak >= releaseWindows) {
        this.closeChord(t, refractoryMs);
      }
    }
  }

  private closeChord(t: number, refractoryMs: number): void {
    this.active = false;
    this.refractoryUntil = t + refractoryMs / 1000;
    this.onEvent?.({ type: "release", t });
  }
}

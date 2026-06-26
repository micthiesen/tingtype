import type { DetectionEvent } from "./dsp/detect.js";

export type Gesture = "tap" | "hold";

export interface GestureOptions {
  /** A chord sustained at least this long fires `hold` (the instant it crosses, not on release). */
  holdMs: number;
  /** Swallow re-triggers for this long after a gesture fires. */
  refractoryMs: number;
}

type State = { kind: "idle" } | { kind: "pending"; onsetT: number } | { kind: "held" };

/**
 * Tap-vs-hold timing machine. A short chord (onset then release before `holdMs`)
 * fires `tap`; a sustained chord fires `hold` the moment its duration crosses
 * `holdMs` — it does not wait for release. Drive {@link tick} from a steady clock
 * (the detector ticks it every analysis window) so `hold` can fire mid-sustain.
 *
 * All timing is in seconds and injected, so tests run deterministically with no
 * real sleeps.
 */
export class GestureDecoder {
  onGesture: ((gesture: Gesture) => void) | null = null;

  private state: State = { kind: "idle" };
  private refractoryUntil = Number.NEGATIVE_INFINITY;

  constructor(private readonly opts: GestureOptions) {}

  /** Route a detector event into the machine. */
  handle(event: DetectionEvent): void {
    if (event.type === "onset") this.onset(event.t);
    else this.release(event.t);
  }

  onset(t: number): void {
    if (this.state.kind !== "idle") return;
    if (t < this.refractoryUntil) return;
    this.state = { kind: "pending", onsetT: t };
  }

  release(t: number): void {
    if (this.state.kind === "pending") {
      this.fire("tap", t);
    } else if (this.state.kind === "held") {
      // Hold already fired; the release just closes the gesture.
      this.state = { kind: "idle" };
    }
  }

  /** Advance the clock; fires `hold` once the pending chord crosses `holdMs`. */
  tick(now: number): void {
    if (this.state.kind !== "pending") return;
    if (now - this.state.onsetT >= this.opts.holdMs / 1000) {
      this.fire("hold", now);
      this.state = { kind: "held" };
    }
  }

  private fire(gesture: Gesture, t: number): void {
    if (gesture === "tap") this.state = { kind: "idle" };
    this.refractoryUntil = t + this.opts.refractoryMs / 1000;
    this.onGesture?.(gesture);
  }
}

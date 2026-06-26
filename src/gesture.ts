import type { DetectionEvent } from "./dsp/detect.js";

export type Gesture = "primary" | "secondary";

export interface GestureOptions {
  /**
   * A tone held continuously for at least this long (ms) fires `secondary`
   * immediately — the instant it crosses, not on release.
   */
  holdMs: number;
  /**
   * Bridge/debounce gap (ms). Silence shorter than this keeps the current "span"
   * open: a second tone onset within it is a double-tap → `secondary`; a lone tap
   * commits `primary` once this elapses with no second onset. Keep it tight so a
   * deliberate double-tap registers while a single tap stays responsive.
   */
  bridgeMs: number;
}

type State =
  | { kind: "idle" }
  | { kind: "active"; spanStartT: number } // tone on, span open, not yet promoted
  | { kind: "gap"; releaseT: number } // tone off, span open, not yet promoted
  | { kind: "done"; releaseT: number | null }; // secondary fired; draining the span

/**
 * Span-based gesture decoder. One physical "span" of tone activity (bridging
 * silence gaps shorter than `bridgeMs`) maps to one gesture:
 *
 *   - `primary`   — a single short tap (no second onset, never held to `holdMs`).
 *                   Commits `bridgeMs` after the tone ends.
 *   - `secondary` — fires early on EITHER a hold (tone present ≥ `holdMs`) OR a
 *                   double-tap (a second onset within the bridge window).
 *
 * Driven by debounced onset/release events plus a presence-aware {@link tick}
 * from the analysis clock. All timing is injected seconds, so tests are
 * deterministic with no real sleeps.
 */
export class GestureDecoder {
  onGesture: ((gesture: Gesture) => void) | null = null;

  private state: State = { kind: "idle" };

  constructor(private readonly opts: GestureOptions) {}

  /** Route a detector event into the machine. */
  handle(event: DetectionEvent): void {
    if (event.type === "onset") this.onset(event.t);
    else this.release(event.t);
  }

  onset(t: number): void {
    switch (this.state.kind) {
      case "idle":
        this.state = { kind: "active", spanStartT: t };
        break;
      case "gap":
        // Second onset within the bridge window → double-tap → secondary.
        this.onGesture?.("secondary");
        this.state = { kind: "done", releaseT: null };
        break;
      // active / done: a stray onset inside the span is swallowed.
    }
  }

  release(t: number): void {
    if (this.state.kind === "active") this.state = { kind: "gap", releaseT: t };
    else if (this.state.kind === "done") this.state = { kind: "done", releaseT: t };
  }

  /**
   * Advance the clock. `present` is the detector's current presence; the hold
   * timer only accrues while the tone is genuinely present, so the release
   * debounce window can't age a short tap into a hold.
   */
  tick(now: number, present: boolean): void {
    const bridge = this.opts.bridgeMs / 1000;
    switch (this.state.kind) {
      case "active":
        if (present && now - this.state.spanStartT >= this.opts.holdMs / 1000) {
          this.onGesture?.("secondary");
          this.state = { kind: "done", releaseT: null };
        }
        break;
      case "gap":
        if (now - this.state.releaseT >= bridge) {
          this.onGesture?.("primary");
          this.state = { kind: "idle" };
        }
        break;
      case "done":
        if (this.state.releaseT !== null && now - this.state.releaseT >= bridge) {
          this.state = { kind: "idle" };
        }
        break;
    }
  }
}

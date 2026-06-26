import { describe, expect, it } from "bun:test";
import { type Gesture, GestureDecoder } from "./gesture.js";

function decoder(holdMs = 400, bridgeMs = 200) {
  const fired: Gesture[] = [];
  const g = new GestureDecoder({ holdMs, bridgeMs });
  g.onGesture = (gesture) => fired.push(gesture);
  return { g, fired };
}

describe("GestureDecoder — single tap → primary", () => {
  it("commits primary bridgeMs after a short tap ends, with no second onset", () => {
    const { g, fired } = decoder(400, 200);
    g.onset(0);
    g.tick(0.05, true);
    g.release(0.1); // 100ms tap
    g.tick(0.25, false); // not yet (only 150ms since release)
    expect(fired).toEqual([]);
    g.tick(0.31, false); // 210ms since release >= bridge
    expect(fired).toEqual(["primary"]);
  });

  it("does not let the release-debounce window age a short tap into a hold", () => {
    const { g, fired } = decoder(400, 200);
    g.onset(0);
    // Held 380ms, then the tone stops but the detector keeps ticking present=false
    // for a few windows before emitting release. Those ticks must NOT promote.
    g.tick(0.38, true);
    g.tick(0.39, false);
    g.tick(0.4, false);
    g.tick(0.41, false);
    expect(fired).toEqual([]);
    g.release(0.41);
    g.tick(0.62, false); // bridge elapsed → primary
    expect(fired).toEqual(["primary"]);
  });
});

describe("GestureDecoder — hold → secondary", () => {
  it("fires secondary the instant the tone crosses holdMs, not on release", () => {
    const { g, fired } = decoder(400, 200);
    g.onset(0);
    g.tick(0.2, true);
    expect(fired).toEqual([]);
    g.tick(0.4, true); // crosses holdMs while present
    expect(fired).toEqual(["secondary"]);
    g.release(0.9); // late release fires nothing more
    g.tick(1.2, false);
    expect(fired).toEqual(["secondary"]);
  });

  it("fires hold exactly once across many ticks past the threshold", () => {
    const { g, fired } = decoder(400, 200);
    g.onset(0);
    for (let t = 0.4; t < 1.0; t += 0.05) g.tick(t, true);
    expect(fired).toEqual(["secondary"]);
  });
});

describe("GestureDecoder — double-tap → secondary", () => {
  it("fires secondary on a second onset within the bridge window", () => {
    const { g, fired } = decoder(400, 200);
    g.onset(0);
    g.release(0.08); // tap 1
    g.tick(0.12, false); // still within bridge
    g.onset(0.15); // tap 2 within 200ms of release → double-tap
    expect(fired).toEqual(["secondary"]);
  });

  it("does NOT fire primary when a double-tap promotes the span", () => {
    const { g, fired } = decoder(400, 200);
    g.onset(0);
    g.release(0.08);
    g.onset(0.15); // secondary
    g.release(0.23);
    g.tick(0.5, false); // span drains, no extra gesture
    expect(fired).toEqual(["secondary"]);
  });

  it("treats a second onset AFTER the bridge as a fresh primary, not a double-tap", () => {
    const { g, fired } = decoder(400, 200);
    g.onset(0);
    g.release(0.08);
    g.tick(0.3, false); // 220ms since release ≥ bridge → primary committed, back to idle
    expect(fired).toEqual(["primary"]);
    g.onset(0.4); // new span
    g.release(0.48);
    g.tick(0.7, false); // another primary
    expect(fired).toEqual(["primary", "primary"]);
  });
});

describe("GestureDecoder — routing", () => {
  it("routes detector events through handle()", () => {
    const { g, fired } = decoder(400, 200);
    g.handle({ type: "onset", t: 0 });
    g.handle({ type: "release", t: 0.1 });
    g.tick(0.35, false);
    expect(fired).toEqual(["primary"]);
  });

  it("ignores a release with no matching onset", () => {
    const { g, fired } = decoder();
    g.release(0.1);
    g.tick(0.4, false);
    expect(fired).toEqual([]);
  });
});

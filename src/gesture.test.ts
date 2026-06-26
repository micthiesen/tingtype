import { describe, expect, it } from "bun:test";
import { type Gesture, GestureDecoder } from "./gesture.js";

function decoder(holdMs = 400, refractoryMs = 250) {
  const fired: Gesture[] = [];
  const g = new GestureDecoder({ holdMs, refractoryMs });
  g.onGesture = (gesture) => fired.push(gesture);
  return { g, fired };
}

describe("GestureDecoder", () => {
  it("fires tap when the chord releases before the hold threshold", () => {
    const { g, fired } = decoder();
    g.onset(0);
    g.tick(0.1);
    g.release(0.15); // 150ms < 400ms
    expect(fired).toEqual(["tap"]);
  });

  it("fires hold the instant the threshold is crossed, not on release", () => {
    const { g, fired } = decoder(400);
    g.onset(0);
    g.tick(0.2);
    expect(fired).toEqual([]); // not yet
    g.tick(0.4); // crosses 400ms
    expect(fired).toEqual(["hold"]);
    g.release(0.9); // late release fires nothing more
    expect(fired).toEqual(["hold"]);
  });

  it("fires hold exactly once even with many ticks past the threshold", () => {
    const { g, fired } = decoder(400);
    g.onset(0);
    for (let t = 0.4; t < 1.0; t += 0.05) g.tick(t);
    expect(fired).toEqual(["hold"]);
  });

  it("ignores onsets during the post-gesture refractory window", () => {
    const { g, fired } = decoder(400, 250);
    g.onset(0);
    g.release(0.1); // tap @ 0.1, refractory until 0.35
    g.onset(0.2); // within refractory → ignored
    g.release(0.25);
    expect(fired).toEqual(["tap"]);
  });

  it("accepts a fresh gesture once the refractory has elapsed", () => {
    const { g, fired } = decoder(400, 250);
    g.onset(0);
    g.release(0.1); // tap, refractory until 0.35
    g.onset(0.5); // past refractory
    g.release(0.6);
    expect(fired).toEqual(["tap", "tap"]);
  });

  it("a tap after a hold works on the next press", () => {
    const { g, fired } = decoder(400, 250);
    g.onset(0);
    g.tick(0.4); // hold @ 0.4, refractory until 0.65
    g.release(0.5);
    g.onset(1.0);
    g.release(1.1); // tap
    expect(fired).toEqual(["hold", "tap"]);
  });

  it("routes detector events through handle() (the production seam)", () => {
    const { g, fired } = decoder(400, 250);
    g.handle({ type: "onset", t: 0 });
    g.handle({ type: "release", t: 0.15 });
    expect(fired).toEqual(["tap"]);
  });

  it("ignores a release with no matching onset", () => {
    const { g, fired } = decoder();
    g.release(0.1);
    expect(fired).toEqual([]);
  });
});

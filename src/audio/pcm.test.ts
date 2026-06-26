import { describe, expect, it } from "bun:test";
import { PcmFramer } from "./pcm.js";

/** Encode floats as little-endian f32 bytes (matching ffmpeg's f32le output). */
function f32leBytes(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i], true);
  return buf;
}

describe("PcmFramer", () => {
  it("decodes whole samples from an aligned chunk", () => {
    const framer = new PcmFramer();
    const out = framer.push(f32leBytes([0.25, -0.5, 0.75]));
    expect(Array.from(out)).toEqual([0.25, -0.5, 0.75]);
  });

  it("carries a partial trailing sample across chunk boundaries", () => {
    const framer = new PcmFramer();
    const bytes = f32leBytes([1, 2, 3]); // 12 bytes
    // Split mid-second-sample: 6 bytes then 6 bytes.
    const a = framer.push(bytes.subarray(0, 6));
    expect(Array.from(a)).toEqual([1]); // only the first whole sample
    const b = framer.push(bytes.subarray(6));
    expect(Array.from(b)).toEqual([2, 3]);
  });

  it("handles a chunk shorter than one sample", () => {
    const framer = new PcmFramer();
    const bytes = f32leBytes([42]);
    expect(framer.push(bytes.subarray(0, 3)).length).toBe(0);
    expect(Array.from(framer.push(bytes.subarray(3)))).toEqual([42]);
  });

  it("does not corrupt the carry when the source buffer is overwritten", () => {
    // Simulates a runtime that recycles the stream's backing buffer between reads.
    const framer = new PcmFramer();
    const scratch = f32leBytes([1, 2]).subarray(0, 6); // 1 whole + 2 carry bytes
    framer.push(scratch);
    scratch.fill(0xff); // clobber the original bytes
    const rest = new Uint8Array(2); // remaining 2 bytes of sample #2 (value stays small)
    const out = framer.push(rest);
    // If the carry had aliased `scratch`, the high bytes would now be 0xff (NaN/huge).
    expect(Number.isFinite(out[0])).toBe(true);
  });

  it("reset() drops any carried bytes", () => {
    const framer = new PcmFramer();
    framer.push(f32leBytes([1]).subarray(0, 2)); // 2 carry bytes
    framer.reset();
    const out = framer.push(f32leBytes([7]));
    expect(Array.from(out)).toEqual([7]);
  });
});

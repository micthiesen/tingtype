import { describe, expect, it } from "bun:test";
import { decodeWav, encodeWavMono16 } from "./wav.js";

describe("WAV encode/decode", () => {
  it("round-trips 16-bit mono samples within quantization error", () => {
    const input = new Float32Array([0, 0.5, -0.5, 0.999, -0.999, 0.25]);
    const { samples, sampleRate } = decodeWav(encodeWavMono16(input, 48000));
    expect(sampleRate).toBe(48000);
    expect(samples.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(samples[i]).toBeCloseTo(input[i], 3);
    }
  });

  it("preserves the sample rate", () => {
    const { sampleRate } = decodeWav(encodeWavMono16(new Float32Array([0.1]), 44100));
    expect(sampleRate).toBe(44100);
  });
});

describe("WAV decode error handling", () => {
  it("rejects a too-small buffer", () => {
    expect(() => decodeWav(new Uint8Array(4))).toThrow(/too small/);
  });

  it("rejects a non-RIFF/WAVE buffer", () => {
    const bytes = new Uint8Array(64);
    expect(() => decodeWav(bytes)).toThrow(/RIFF\/WAVE/);
  });

  it("does not over-read when the data chunk claims more than the file holds", () => {
    // Encode a valid file, then inflate the declared data size to ~4GB.
    const wav = encodeWavMono16(new Float32Array([0.1, 0.2, 0.3]), 48000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    view.setUint32(40, 0xffffffff, true); // data chunk size
    const { samples } = decodeWav(wav); // clamped to the real buffer, no throw
    expect(samples.length).toBe(3);
  });

  it("rejects an unsupported bit depth", () => {
    const wav = encodeWavMono16(new Float32Array([0.1]), 48000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    view.setUint16(34, 24, true); // bitsPerSample = 24
    expect(() => decodeWav(wav)).toThrow(/Unsupported/);
  });
});

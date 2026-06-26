/** Minimal WAV IO for `gen` (write) and `test` (read). Mono only. */

export interface WavData {
  samples: Float32Array;
  sampleRate: number;
}

/** Encode mono float samples [-1, 1] as a 16-bit PCM WAV byte buffer. */
export function encodeWavMono16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, 1, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, Math.round(clamped * 32767), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/**
 * Decode a WAV byte buffer to mono float samples. Supports 16-bit PCM and
 * 32-bit IEEE float; multi-channel input is down-mixed by averaging.
 */
export function decodeWav(bytes: Uint8Array): WavData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a RIFF/WAVE file");

  let format = 1;
  let channels = 1;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = tag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (chunkId === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (chunkId === "data") {
      dataOffset = body;
      dataLength = chunkSize;
    }
    offset = body + chunkSize + (chunkSize & 1); // chunks are word-aligned
  }
  if (dataOffset < 0) throw new Error("WAV has no data chunk");

  const bytesPerSample = bitsPerSample >> 3;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOffset + (i * channels + c) * bytesPerSample;
      if (format === 3 && bitsPerSample === 32) sum += view.getFloat32(p, true);
      else if (bitsPerSample === 16) sum += view.getInt16(p, true) / 32768;
      else if (bitsPerSample === 32) sum += view.getInt32(p, true) / 2147483648;
      else
        throw new Error(
          `Unsupported WAV sample format: ${bitsPerSample}-bit, fmt ${format}`,
        );
    }
    samples[i] = sum / channels;
  }
  return { samples, sampleRate };
}

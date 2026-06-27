const EMPTY_BYTES = new Uint8Array(0);
const EMPTY_FLOATS = new Float32Array(0);

/**
 * Frames a byte stream of little-endian float32 PCM into `Float32Array` blocks,
 * carrying any partial trailing sample (1–3 bytes) across `push` calls. Pure and
 * deterministic — the carry logic is unit-tested without spawning ffmpeg.
 *
 * Both target platforms run little-endian (macOS arm64/x86_64, Linux x86_64), so
 * a copied byte range views directly as f32le with no per-sample decoding.
 */
export class PcmFramer {
  private leftover: Uint8Array = EMPTY_BYTES;

  push(chunk: Uint8Array): Float32Array {
    const buf = this.leftover.byteLength === 0 ? chunk : concat(this.leftover, chunk);
    const sampleCount = buf.byteLength >>> 2; // 4 bytes per float
    const usableBytes = sampleCount << 2;

    // Copy the carry bytes out — never retain a view into a stream chunk the
    // runtime may recycle on the next read.
    this.leftover =
      usableBytes < buf.byteLength
        ? Uint8Array.from(buf.subarray(usableBytes))
        : EMPTY_BYTES;

    if (sampleCount === 0) return EMPTY_FLOATS;
    const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + usableBytes);
    return new Float32Array(aligned);
  }

  reset(): void {
    this.leftover = EMPTY_BYTES;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

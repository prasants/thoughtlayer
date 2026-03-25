/**
 * Embedding Codecs
 *
 * Encode/decode Float32Array embeddings to/from compact Buffer representations.
 * Used by the storage layer to compress embeddings on disk.
 *
 * RawCodec: no compression (4 bytes per dim, current behaviour)
 * Int8Codec: scalar quantisation (1 byte per dim + 8 byte header = ~4x compression)
 */

export interface EmbeddingCodec {
  readonly name: string;
  encode(vec: Float32Array): Buffer;
  decode(buf: Buffer): Float32Array;
}

/**
 * Raw codec: stores Float32Array as-is in a Buffer.
 * 4 bytes per dimension. Zero overhead, zero loss.
 */
export class RawCodec implements EmbeddingCodec {
  readonly name = 'raw';

  encode(vec: Float32Array): Buffer {
    return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
  }

  decode(buf: Buffer): Float32Array {
    const ab = new ArrayBuffer(buf.length);
    const view = new Uint8Array(ab);
    view.set(buf);
    return new Float32Array(ab);
  }
}

/**
 * Int8 scalar quantisation codec.
 *
 * Layout: [min: float32][max: float32][quantised: uint8 x N]
 * Total: 8 + N bytes (vs 4N bytes for raw).
 *
 * For 768-dim vectors: 776 bytes vs 3,072 bytes (3.96x compression).
 * For 1536-dim vectors: 1,544 bytes vs 6,144 bytes (3.98x compression).
 *
 * Quantisation error is bounded: max error per dimension = (max - min) / 255.
 * For typical normalised embeddings (range ~[-0.1, 0.1]), error < 0.0008 per dim.
 * Cosine similarity error is negligible at these magnitudes.
 */
export class Int8Codec implements EmbeddingCodec {
  readonly name = 'int8';

  encode(vec: Float32Array): Buffer {
    const n = vec.length;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < n; i++) {
      if (vec[i] < min) min = vec[i];
      if (vec[i] > max) max = vec[i];
    }

    const range = max - min;
    const buf = Buffer.alloc(8 + n);

    buf.writeFloatLE(min, 0);
    buf.writeFloatLE(max, 4);

    if (range === 0) {
      buf.fill(0, 8);
    } else {
      const scale = 255 / range;
      for (let i = 0; i < n; i++) {
        buf[8 + i] = Math.round((vec[i] - min) * scale);
      }
    }

    return buf;
  }

  decode(buf: Buffer): Float32Array {
    const min = buf.readFloatLE(0);
    const max = buf.readFloatLE(4);
    const n = buf.length - 8;
    const range = max - min;

    const vec = new Float32Array(n);

    if (range === 0) {
      vec.fill(min);
    } else {
      const scale = range / 255;
      for (let i = 0; i < n; i++) {
        vec[i] = min + buf[8 + i] * scale;
      }
    }

    return vec;
  }
}

/**
 * Get a codec by name.
 */
export function getCodec(name: string): EmbeddingCodec {
  switch (name) {
    case 'raw':
      return new RawCodec();
    case 'int8':
      return new Int8Codec();
    default:
      throw new Error(`Unknown embedding codec: ${name}. Supported: raw, int8`);
  }
}

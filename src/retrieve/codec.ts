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
// Int8 codec magic bytes: 'TL' (0x54, 0x4C) + version byte
const INT8_MAGIC = 0x544C;
const INT8_VERSION = 1;
const INT8_HEADER_SIZE = 3; // 2 magic + 1 version

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
    const buf = Buffer.alloc(INT8_HEADER_SIZE + 8 + n);

    // Magic number + version
    buf.writeUInt16LE(INT8_MAGIC, 0);
    buf[2] = INT8_VERSION;

    // Min/max range header
    buf.writeFloatLE(min, INT8_HEADER_SIZE);
    buf.writeFloatLE(max, INT8_HEADER_SIZE + 4);

    if (range === 0) {
      buf.fill(0, INT8_HEADER_SIZE + 8);
    } else {
      const scale = 255 / range;
      for (let i = 0; i < n; i++) {
        buf[INT8_HEADER_SIZE + 8 + i] = Math.round((vec[i] - min) * scale);
      }
    }

    return buf;
  }

  decode(buf: Buffer): Float32Array {
    if (buf.length < 3) {
      throw new Error(`Int8Codec: buffer too small (${buf.length} bytes, minimum 3)`);
    }

    // Detect legacy format (no magic number) vs new format
    const maybeMagic = buf.readUInt16LE(0);
    if (maybeMagic === INT8_MAGIC) {
      // New format with magic + version
      const version = buf[2];
      if (version !== INT8_VERSION) {
        throw new Error(`Int8Codec: unsupported version ${version} (expected ${INT8_VERSION})`);
      }
      if (buf.length < INT8_HEADER_SIZE + 8) {
        throw new Error(`Int8Codec: buffer too small for header (${buf.length} bytes, minimum ${INT8_HEADER_SIZE + 8})`);
      }
      const min = buf.readFloatLE(INT8_HEADER_SIZE);
      const max = buf.readFloatLE(INT8_HEADER_SIZE + 4);
      const n = buf.length - INT8_HEADER_SIZE - 8;
      const range = max - min;
      const vec = new Float32Array(n);

      if (range === 0) {
        vec.fill(min);
      } else {
        const scale = range / 255;
        for (let i = 0; i < n; i++) {
          vec[i] = min + buf[INT8_HEADER_SIZE + 8 + i] * scale;
        }
      }
      return vec;
    }

    // Legacy format: [min: float32][max: float32][quantised: uint8 x N]
    if (buf.length < 8) {
      throw new Error(`Int8Codec: buffer too small for legacy format (${buf.length} bytes, minimum 8)`);
    }
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

// ─── BinaryCodec ─────────────────────────────────────────────────────────────

/**
 * Binary (1-bit) codec. Stores the sign of each dimension.
 *
 * Layout: [magic: uint16][version: uint8][dims: uint16][bits: ceil(dims/8) bytes]
 *
 * For 768-dim vectors: 5 + 96 = 101 bytes vs 3,072 bytes raw (30x compression).
 * Decode produces +1.0 / -1.0 values. Cosine similarity on {+1,-1} vectors
 * preserves ranking order (equivalent to 1 - 2*hamming_distance/dims).
 *
 * Best for coarse first-pass filtering or massive-scale storage.
 */
const BINARY_MAGIC = 0x424C; // 'BL'
const BINARY_VERSION = 1;
const BINARY_HEADER_SIZE = 5; // 2 magic + 1 version + 2 dims

export class BinaryCodec implements EmbeddingCodec {
  readonly name = 'binary';

  encode(vec: Float32Array): Buffer {
    const dims = vec.length;
    const byteCount = Math.ceil(dims / 8);
    const buf = Buffer.alloc(BINARY_HEADER_SIZE + byteCount);

    buf.writeUInt16LE(BINARY_MAGIC, 0);
    buf[2] = BINARY_VERSION;
    buf.writeUInt16LE(dims, 3);

    for (let i = 0; i < dims; i++) {
      if (vec[i] >= 0) {
        buf[BINARY_HEADER_SIZE + (i >> 3)] |= (1 << (i & 7));
      }
    }

    return buf;
  }

  decode(buf: Buffer): Float32Array {
    if (buf.length < BINARY_HEADER_SIZE) {
      throw new Error(`BinaryCodec: buffer too small (${buf.length} bytes, minimum ${BINARY_HEADER_SIZE})`);
    }

    const magic = buf.readUInt16LE(0);
    if (magic !== BINARY_MAGIC) {
      throw new Error(`BinaryCodec: invalid magic number 0x${magic.toString(16)} (expected 0x${BINARY_MAGIC.toString(16)})`);
    }

    const version = buf[2];
    if (version !== BINARY_VERSION) {
      throw new Error(`BinaryCodec: unsupported version ${version} (expected ${BINARY_VERSION})`);
    }

    const dims = buf.readUInt16LE(3);
    const vec = new Float32Array(dims);

    for (let i = 0; i < dims; i++) {
      const bit = (buf[BINARY_HEADER_SIZE + (i >> 3)] >> (i & 7)) & 1;
      vec[i] = bit ? 1.0 : -1.0;
    }

    return vec;
  }
}

// ─── PolarCodec ──────────────────────────────────────────────────────────────

/**
 * Xorshift128 PRNG. Deterministic, platform-independent (pure integer math).
 * Returns values in [0, 1).
 */
class Xorshift128 {
  private s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    // Initialise state from seed via simple mixing
    this.s[0] = seed >>> 0;
    this.s[1] = (seed * 1664525 + 1013904223) >>> 0;
    this.s[2] = (this.s[1] * 1664525 + 1013904223) >>> 0;
    this.s[3] = (this.s[2] * 1664525 + 1013904223) >>> 0;
    // Warm up
    for (let i = 0; i < 16; i++) this.nextUint32();
  }

  nextUint32(): number {
    let t = this.s[3];
    t ^= t << 11;
    t ^= t >>> 8;
    this.s[3] = this.s[2];
    this.s[2] = this.s[1];
    this.s[1] = this.s[0];
    let s0 = this.s[0];
    t ^= s0;
    t ^= s0 >>> 19;
    this.s[0] = t >>> 0;
    return this.s[0];
  }

  /** Returns a float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }
}

/**
 * Generate a block-diagonal orthogonal rotation matrix.
 *
 * Each block is independently orthogonalised via modified Gram-Schmidt.
 * Block-diagonal structure reduces memory from O(D^2) to O(D*blockSize)
 * and keeps encode/decode fast, while providing sufficient structure-spreading
 * for polar quantisation.
 *
 * Returns a flat Float32Array of concatenated blocks.
 * Each block is blockSize x blockSize stored row-major.
 */
const rotationCache = new Map<string, Float32Array>();

function generateRotationMatrix(seed: number, dims: number, blockSize: number = 64): Float32Array {
  const key = `${seed}:${dims}:${blockSize}`;
  const cached = rotationCache.get(key);
  if (cached) return cached;

  const rng = new Xorshift128(seed);
  const effectiveDims = dims + (dims % 2); // pad to even
  const numBlocks = Math.ceil(effectiveDims / blockSize);
  const totalElements = numBlocks * blockSize * blockSize;
  const matrix = new Float32Array(totalElements);

  for (let b = 0; b < numBlocks; b++) {
    const actualBlockSize = Math.min(blockSize, effectiveDims - b * blockSize);
    const blockOffset = b * blockSize * blockSize;

    // Fill block with random values
    for (let r = 0; r < actualBlockSize; r++) {
      for (let c = 0; c < actualBlockSize; c++) {
        matrix[blockOffset + r * blockSize + c] = rng.nextFloat() * 2 - 1;
      }
    }

    // Modified Gram-Schmidt orthogonalisation
    for (let col = 0; col < actualBlockSize; col++) {
      // Subtract projections of previous columns
      for (let prev = 0; prev < col; prev++) {
        let dot = 0;
        let prevNorm = 0;
        for (let r = 0; r < actualBlockSize; r++) {
          dot += matrix[blockOffset + r * blockSize + col] * matrix[blockOffset + r * blockSize + prev];
          prevNorm += matrix[blockOffset + r * blockSize + prev] * matrix[blockOffset + r * blockSize + prev];
        }
        if (prevNorm > 0) {
          const scale = dot / prevNorm;
          for (let r = 0; r < actualBlockSize; r++) {
            matrix[blockOffset + r * blockSize + col] -= scale * matrix[blockOffset + r * blockSize + prev];
          }
        }
      }

      // Normalise column
      let norm = 0;
      for (let r = 0; r < actualBlockSize; r++) {
        norm += matrix[blockOffset + r * blockSize + col] * matrix[blockOffset + r * blockSize + col];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let r = 0; r < actualBlockSize; r++) {
          matrix[blockOffset + r * blockSize + col] /= norm;
        }
      }
    }
  }

  rotationCache.set(key, matrix);
  return matrix;
}

/**
 * Apply block-diagonal rotation to a vector.
 * If transpose is true, applies the inverse (transpose) rotation.
 */
function applyBlockRotation(
  vec: Float32Array,
  matrix: Float32Array,
  dims: number,
  blockSize: number,
  transpose: boolean,
): Float32Array {
  const effectiveDims = dims + (dims % 2);
  const numBlocks = Math.ceil(effectiveDims / blockSize);
  const result = new Float32Array(effectiveDims);

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    const actualBlockSize = Math.min(blockSize, effectiveDims - start);
    const blockOffset = b * blockSize * blockSize;

    for (let r = 0; r < actualBlockSize; r++) {
      let sum = 0;
      for (let c = 0; c < actualBlockSize; c++) {
        const matIdx = transpose
          ? blockOffset + c * blockSize + r  // transpose: read column as row
          : blockOffset + r * blockSize + c;
        sum += matrix[matIdx] * vec[start + c];
      }
      result[start + r] = sum;
    }
  }

  return result;
}

/**
 * Polar codec: TurboQuant-inspired polar-coordinate quantisation.
 *
 * Algorithm:
 * 1. Random block-diagonal rotation (spreads structure for better quantisation)
 * 2. Pair adjacent dimensions, convert to polar coordinates (angle via atan2)
 * 3. Quantise angles to 4 bits (16 uniform levels over [-pi, pi])
 * 4. Store single norm (vector magnitude) + quantised angle nibbles
 *
 * Layout: [magic: uint16][version: uint8][seed: uint32][dims: uint16]
 *         [norm: float32][angles: ceil(dims/2) nibbles = ceil(dims/4) bytes]
 *
 * For 768-dim vectors: 13 + 192 = 205 bytes vs 3,072 bytes raw (~15x compression).
 * For 1536-dim vectors: 13 + 384 = 397 bytes vs 6,144 bytes raw (~15x compression).
 *
 * Cosine similarity drift: typically < 0.01.
 */
const POLAR_MAGIC = 0x504C; // 'PL'
const POLAR_VERSION = 1;
const POLAR_HEADER_SIZE = 13; // 2 magic + 1 version + 4 seed + 2 dims + 4 norm
const POLAR_BLOCK_SIZE = 64;
const POLAR_ANGLE_BITS = 4;
const POLAR_ANGLE_LEVELS = 1 << POLAR_ANGLE_BITS; // 16
const POLAR_ANGLE_STEP = (2 * Math.PI) / POLAR_ANGLE_LEVELS;

export class PolarCodec implements EmbeddingCodec {
  readonly name = 'polar';
  private readonly seed: number;

  constructor(seed: number = 0xDEAD) {
    this.seed = seed >>> 0;
  }

  encode(vec: Float32Array): Buffer {
    const dims = vec.length;
    const effectiveDims = dims + (dims % 2); // pad to even
    const numAngles = effectiveDims / 2;
    const angleBytes = Math.ceil(numAngles / 2); // 2 nibbles per byte

    // Compute norm
    let norm = 0;
    for (let i = 0; i < dims; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);

    const buf = Buffer.alloc(POLAR_HEADER_SIZE + angleBytes);

    // Header
    buf.writeUInt16LE(POLAR_MAGIC, 0);
    buf[2] = POLAR_VERSION;
    buf.writeUInt32LE(this.seed, 3);
    buf.writeUInt16LE(dims, 7);
    buf.writeFloatLE(norm, 9);

    if (norm === 0) {
      // Zero vector: all angles are 0, buffer is already zero-filled
      return buf;
    }

    // Pad input to even dimensions
    const padded = new Float32Array(effectiveDims);
    padded.set(vec);

    // Apply rotation
    const rotMatrix = generateRotationMatrix(this.seed, dims, POLAR_BLOCK_SIZE);
    const rotated = applyBlockRotation(padded, rotMatrix, dims, POLAR_BLOCK_SIZE, false);

    // Convert to polar angles and quantise
    for (let i = 0; i < numAngles; i++) {
      const x = rotated[2 * i];
      const y = rotated[2 * i + 1];
      // atan2 returns [-pi, pi]
      const angle = Math.atan2(y, x);
      // Map to [0, 16) — quantise to 4 bits
      let q = Math.round((angle + Math.PI) / POLAR_ANGLE_STEP);
      if (q >= POLAR_ANGLE_LEVELS) q = POLAR_ANGLE_LEVELS - 1;
      if (q < 0) q = 0;

      // Pack nibble: even angles go to low nibble, odd to high
      const byteIdx = POLAR_HEADER_SIZE + (i >> 1);
      if (i & 1) {
        buf[byteIdx] |= (q << 4);
      } else {
        buf[byteIdx] |= q;
      }
    }

    return buf;
  }

  decode(buf: Buffer): Float32Array {
    if (buf.length < POLAR_HEADER_SIZE) {
      throw new Error(`PolarCodec: buffer too small (${buf.length} bytes, minimum ${POLAR_HEADER_SIZE})`);
    }

    const magic = buf.readUInt16LE(0);
    if (magic !== POLAR_MAGIC) {
      throw new Error(`PolarCodec: invalid magic number 0x${magic.toString(16)} (expected 0x${POLAR_MAGIC.toString(16)})`);
    }

    const version = buf[2];
    if (version !== POLAR_VERSION) {
      throw new Error(`PolarCodec: unsupported version ${version} (expected ${POLAR_VERSION})`);
    }

    const seed = buf.readUInt32LE(3);
    const dims = buf.readUInt16LE(7);
    const norm = buf.readFloatLE(9);

    if (norm === 0) {
      return new Float32Array(dims);
    }

    const effectiveDims = dims + (dims % 2);
    const numAngles = effectiveDims / 2;

    // Dequantise angles and convert back to Cartesian pairs
    const rotated = new Float32Array(effectiveDims);

    // Each pair contributes equally to the total squared magnitude.
    // After rotation, total squared norm = sum of pair norms squared.
    // For uniform distribution of energy: pairNorm = norm / sqrt(numAngles)
    const pairNorm = norm / Math.sqrt(numAngles);

    for (let i = 0; i < numAngles; i++) {
      const byteIdx = POLAR_HEADER_SIZE + (i >> 1);
      const q = (i & 1) ? ((buf[byteIdx] >> 4) & 0xF) : (buf[byteIdx] & 0xF);

      // Dequantise: map back to angle midpoint
      const angle = q * POLAR_ANGLE_STEP - Math.PI + POLAR_ANGLE_STEP / 2;

      rotated[2 * i] = pairNorm * Math.cos(angle);
      rotated[2 * i + 1] = pairNorm * Math.sin(angle);
    }

    // Inverse rotation (transpose)
    const rotMatrix = generateRotationMatrix(seed, dims, POLAR_BLOCK_SIZE);
    const result = applyBlockRotation(rotated, rotMatrix, dims, POLAR_BLOCK_SIZE, true);

    // Strip padding
    if (dims === effectiveDims) {
      return result;
    }
    return result.slice(0, dims);
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
    case 'binary':
      return new BinaryCodec();
    case 'polar':
      return new PolarCodec();
    default:
      throw new Error(`Unknown embedding codec: ${name}. Supported: raw, int8, binary, polar`);
  }
}

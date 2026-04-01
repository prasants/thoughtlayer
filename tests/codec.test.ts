import { describe, it, expect } from 'vitest';
import { RawCodec, Int8Codec, getCodec } from '../src/retrieve/codec.js';
import { cosineSimilarity } from '../src/retrieve/vector.js';

describe('RawCodec', () => {
  const codec = new RawCodec();

  it('round-trips a vector exactly', () => {
    const vec = new Float32Array([0.1, -0.2, 0.3, 0.0, -0.05]);
    const decoded = codec.decode(codec.encode(vec));
    expect(decoded.length).toBe(vec.length);
    for (let i = 0; i < vec.length; i++) {
      expect(decoded[i]).toBe(vec[i]);
    }
  });

  it('has name "raw"', () => {
    expect(codec.name).toBe('raw');
  });
});

describe('Int8Codec', () => {
  const codec = new Int8Codec();

  it('compresses to ~4x smaller', () => {
    const vec = new Float32Array(768);
    for (let i = 0; i < 768; i++) vec[i] = (Math.random() - 0.5) * 0.2;

    const raw = Buffer.from(vec.buffer);
    const compressed = codec.encode(vec);

    expect(compressed.length).toBe(3 + 8 + 768); // 779 bytes (3 header + 8 min/max + 768 quantised)
    expect(raw.length).toBe(768 * 4); // 3072 bytes
    expect(compressed.length / raw.length).toBeLessThan(0.3);
  });

  it('round-trips with negligible cosine similarity loss', () => {
    const dims = 768;
    const a = new Float32Array(dims);
    const b = new Float32Array(dims);
    for (let i = 0; i < dims; i++) {
      a[i] = (Math.random() - 0.5) * 0.2;
      b[i] = (Math.random() - 0.5) * 0.2;
    }

    const originalSim = cosineSimilarity(a, b);
    const aDecoded = codec.decode(codec.encode(a));
    const bDecoded = codec.decode(codec.encode(b));
    const compressedSim = cosineSimilarity(aDecoded, bDecoded);

    // Similarity should be within 0.005 of original
    expect(Math.abs(originalSim - compressedSim)).toBeLessThan(0.005);
  });

  it('preserves ranking order across 100 vectors', () => {
    const dims = 768;
    const query = new Float32Array(dims);
    for (let i = 0; i < dims; i++) query[i] = (Math.random() - 0.5) * 0.2;

    const corpus: Float32Array[] = [];
    for (let j = 0; j < 100; j++) {
      const v = new Float32Array(dims);
      for (let i = 0; i < dims; i++) v[i] = (Math.random() - 0.5) * 0.2;
      corpus.push(v);
    }

    // Rank by original similarity
    const originalRanking = corpus
      .map((v, idx) => ({ idx, sim: cosineSimilarity(query, v) }))
      .sort((a, b) => b.sim - a.sim)
      .map(r => r.idx);

    // Rank by compressed similarity
    const queryDec = codec.decode(codec.encode(query));
    const compressedRanking = corpus
      .map((v, idx) => ({ idx, sim: cosineSimilarity(queryDec, codec.decode(codec.encode(v))) }))
      .sort((a, b) => b.sim - a.sim)
      .map(r => r.idx);

    // Top-10 should overlap significantly (at least 8 of 10)
    const top10Original = new Set(originalRanking.slice(0, 10));
    const top10Compressed = new Set(compressedRanking.slice(0, 10));
    let overlap = 0;
    for (const idx of top10Compressed) {
      if (top10Original.has(idx)) overlap++;
    }
    expect(overlap).toBeGreaterThanOrEqual(8);
  });

  it('handles zero vector', () => {
    const vec = new Float32Array(10).fill(0);
    const decoded = codec.decode(codec.encode(vec));
    for (let i = 0; i < 10; i++) {
      expect(decoded[i]).toBe(0);
    }
  });

  it('handles constant vector', () => {
    const vec = new Float32Array(10).fill(0.42);
    const decoded = codec.decode(codec.encode(vec));
    for (let i = 0; i < 10; i++) {
      expect(decoded[i]).toBeCloseTo(0.42, 2);
    }
  });

  it('handles 1536-dim OpenAI vectors', () => {
    const vec = new Float32Array(1536);
    for (let i = 0; i < 1536; i++) vec[i] = (Math.random() - 0.5) * 0.2;

    const compressed = codec.encode(vec);
    expect(compressed.length).toBe(3 + 8 + 1536); // 3 header + 8 min/max + 1536 quantised

    const decoded = codec.decode(compressed);
    const sim = cosineSimilarity(vec, decoded);
    expect(sim).toBeGreaterThan(0.999);
  });

  it('has name "int8"', () => {
    expect(codec.name).toBe('int8');
  });
});

describe('getCodec', () => {
  it('returns RawCodec for "raw"', () => {
    expect(getCodec('raw').name).toBe('raw');
  });

  it('returns Int8Codec for "int8"', () => {
    expect(getCodec('int8').name).toBe('int8');
  });

  it('throws for unknown codec', () => {
    expect(() => getCodec('float16')).toThrow('Unknown embedding codec');
  });
});

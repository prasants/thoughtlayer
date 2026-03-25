import { describe, it, expect } from 'vitest';
import { cosineSimilarity, vectorSearch } from '../src/retrieve/vector.js';

describe('Vector Search', () => {
  it('cosine similarity of identical vectors is 1', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5);
  });

  it('cosine similarity of orthogonal vectors is 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('cosine similarity of opposite vectors is -1', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('vectorSearch returns top-k sorted by similarity', () => {
    const query = new Float32Array([1, 0, 0]);
    const corpus = [
      { entryId: 'a', embedding: new Float32Array([0.9, 0.1, 0]) },
      { entryId: 'b', embedding: new Float32Array([0, 1, 0]) },
      { entryId: 'c', embedding: new Float32Array([0.5, 0.5, 0]) },
    ];

    const results = vectorSearch(query, corpus, 2);
    expect(results.length).toBe(2);
    expect(results[0].entryId).toBe('a');
    expect(results[1].entryId).toBe('c');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});

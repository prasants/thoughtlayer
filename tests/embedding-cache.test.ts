/**
 * Tests for EmbeddingCache (LRU cache for embeddings)
 */

import { describe, it, expect } from 'vitest';
import { EmbeddingCache } from '../src/retrieve/embeddings.js';

describe('EmbeddingCache', () => {
  it('should store and retrieve embeddings', () => {
    const cache = new EmbeddingCache(10);
    const key = EmbeddingCache.hashKey('hello world');
    const embedding = new Float32Array([1.0, 2.0, 3.0]);

    cache.set(key, embedding);
    const result = cache.get(key);

    expect(result).toBeDefined();
    expect(result).toEqual(embedding);
  });

  it('should return undefined for cache miss', () => {
    const cache = new EmbeddingCache(10);
    const key = EmbeddingCache.hashKey('not in cache');

    expect(cache.get(key)).toBeUndefined();
  });

  it('should evict oldest entry when full', () => {
    const cache = new EmbeddingCache(3);

    const keys = ['a', 'b', 'c', 'd'].map(t => EmbeddingCache.hashKey(t));
    keys.forEach((k, i) => cache.set(k, new Float32Array([i])));

    // 'a' should be evicted (oldest)
    expect(cache.get(keys[0])).toBeUndefined();
    // 'b', 'c', 'd' should still be present
    expect(cache.get(keys[1])).toBeDefined();
    expect(cache.get(keys[2])).toBeDefined();
    expect(cache.get(keys[3])).toBeDefined();
    expect(cache.size).toBe(3);
  });

  it('should promote accessed entries (LRU behavior)', () => {
    const cache = new EmbeddingCache(3);

    const keys = ['a', 'b', 'c'].map(t => EmbeddingCache.hashKey(t));
    keys.forEach((k, i) => cache.set(k, new Float32Array([i])));

    // Access 'a' to make it most recently used
    cache.get(keys[0]);

    // Insert 'd' — should evict 'b' (now oldest), not 'a'
    const keyD = EmbeddingCache.hashKey('d');
    cache.set(keyD, new Float32Array([99]));

    expect(cache.get(keys[0])).toBeDefined(); // 'a' still present
    expect(cache.get(keys[1])).toBeUndefined(); // 'b' evicted
    expect(cache.get(keys[2])).toBeDefined(); // 'c' present
    expect(cache.get(keyD)).toBeDefined(); // 'd' present
  });

  it('should produce deterministic hash keys', () => {
    const key1 = EmbeddingCache.hashKey('test input');
    const key2 = EmbeddingCache.hashKey('test input');
    const key3 = EmbeddingCache.hashKey('different input');

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toHaveLength(64); // SHA-256 hex
  });

  it('should update value when setting existing key', () => {
    const cache = new EmbeddingCache(10);
    const key = EmbeddingCache.hashKey('hello');

    cache.set(key, new Float32Array([1.0]));
    cache.set(key, new Float32Array([2.0]));

    expect(cache.size).toBe(1);
    expect(cache.get(key)).toEqual(new Float32Array([2.0]));
  });

  it('should clear all entries', () => {
    const cache = new EmbeddingCache(10);
    cache.set(EmbeddingCache.hashKey('a'), new Float32Array([1]));
    cache.set(EmbeddingCache.hashKey('b'), new Float32Array([2]));

    cache.clear();
    expect(cache.size).toBe(0);
  });
});

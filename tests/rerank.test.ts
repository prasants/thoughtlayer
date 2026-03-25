import { describe, it, expect } from 'vitest';
import { rerank, type RerankConfig } from '../src/retrieve/rerank.js';
import type { RetrievalResult } from '../src/retrieve/pipeline.js';

function makeMockResult(id: string, title: string, score: number): RetrievalResult {
  return {
    entry: {
      id,
      domain: 'test',
      topic: null,
      title,
      content: `Content for ${title}`,
      importance: 0.5,
      version: 1,
      tags: [],
      keywords: [],
      facts: [],
      status: 'active',
      source_type: 'manual',
      source_ref: null,
      parent_id: null,
      supersedes: null,
      content_hash: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      freshness_at: new Date().toISOString(),
    },
    score,
    sources: {
      rrf: score,
      freshness: 0.5,
      importance: 0.5,
    },
  };
}

describe('LLM Reranking', () => {
  it('returns results unchanged when disabled', async () => {
    const results = [
      makeMockResult('1', 'First', 0.9),
      makeMockResult('2', 'Second', 0.7),
    ];

    const config: RerankConfig = { enabled: false };
    const output = await rerank('test query', results, config);

    expect(output.reranked).toBe(false);
    expect(output.results).toEqual(results);
    expect(output.latencyMs).toBe(0);
  });

  it('returns results unchanged when results are empty', async () => {
    const config: RerankConfig = { enabled: true };
    const output = await rerank('test query', [], config);

    expect(output.reranked).toBe(false);
    expect(output.results).toEqual([]);
  });

  it('handles LLM failure gracefully', async () => {
    const results = [
      makeMockResult('1', 'First', 0.9),
      makeMockResult('2', 'Second', 0.7),
    ];

    // Use a fake provider that will fail
    const config: RerankConfig = {
      enabled: true,
      provider: 'openai',
      apiKey: 'sk-fake-key-that-will-fail',
      baseUrl: 'http://localhost:1/fake',
      timeoutMs: 1000,
    };

    const output = await rerank('test query', results, config);

    // Should return original results on failure
    expect(output.reranked).toBe(false);
    expect(output.results).toEqual(results);
    expect(output.error).toBeDefined();
  });

  it('preserves results beyond candidate count', async () => {
    const results = Array.from({ length: 25 }, (_, i) =>
      makeMockResult(`${i}`, `Entry ${i}`, 1 - i * 0.04)
    );

    const config: RerankConfig = {
      enabled: true,
      provider: 'openai',
      apiKey: 'sk-fake',
      baseUrl: 'http://localhost:1/fake',
      candidateCount: 10,
      timeoutMs: 1000,
    };

    const output = await rerank('test query', results, config);

    // Even on failure, all results should be returned
    expect(output.results.length).toBe(25);
  });
});

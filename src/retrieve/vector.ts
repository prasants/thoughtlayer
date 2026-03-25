/**
 * Vector Search
 *
 * Pure cosine similarity for Phase 0. No sqlite-vss dependency.
 * At <10K entries, brute-force cosine is fast enough (<50ms).
 * Phase 1 adds HNSW index via sqlite-vss for O(log n) search.
 */

export interface VectorResult {
  entryId: string;
  score: number;
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}

/**
 * Brute-force vector search across all embeddings.
 * Returns top-k results sorted by cosine similarity.
 */
export function vectorSearch(
  query: Float32Array,
  corpus: Array<{ entryId: string; embedding: Float32Array }>,
  topK: number = 10
): VectorResult[] {
  const scores: VectorResult[] = corpus.map(item => ({
    entryId: item.entryId,
    score: cosineSimilarity(query, item.embedding),
  }));

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

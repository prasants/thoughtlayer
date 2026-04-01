/**
 * Vector Search
 *
 * Cosine similarity with in-memory index for cache-friendly access.
 * On first query, builds a flat Float32Array matrix from the corpus.
 * Subsequent queries reuse the matrix until invalidated.
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
 * In-memory vector index for cache-friendly brute-force search.
 *
 * Stores vectors in a contiguous Float32Array matrix for optimal
 * memory layout and CPU cache performance. Supports incremental
 * updates without full rebuild.
 */
export class VectorIndex {
  private ids: string[] = [];
  private matrix: Float32Array | null = null;
  private dims: number = 0;
  private dirty: boolean = true;

  /**
   * Build the index from a corpus of embeddings.
   * Call this once, then use search() for queries.
   */
  build(corpus: Array<{ entryId: string; embedding: Float32Array }>): void {
    if (corpus.length === 0) {
      this.ids = [];
      this.matrix = null;
      this.dims = 0;
      this.dirty = false;
      return;
    }

    this.dims = corpus[0].embedding.length;
    this.ids = new Array(corpus.length);
    this.matrix = new Float32Array(corpus.length * this.dims);

    for (let i = 0; i < corpus.length; i++) {
      this.ids[i] = corpus[i].entryId;
      this.matrix.set(corpus[i].embedding, i * this.dims);
    }

    this.dirty = false;
  }

  /**
   * Add a single entry to the index without full rebuild.
   */
  add(entryId: string, embedding: Float32Array): void {
    if (this.matrix === null || this.dims === 0) {
      this.dims = embedding.length;
      this.matrix = new Float32Array(embedding);
      this.ids = [entryId];
      this.dirty = false;
      return;
    }

    if (embedding.length !== this.dims) {
      throw new Error(`Dimension mismatch: index has ${this.dims}, got ${embedding.length}`);
    }

    // Grow the matrix
    const newMatrix = new Float32Array((this.ids.length + 1) * this.dims);
    newMatrix.set(this.matrix);
    newMatrix.set(embedding, this.ids.length * this.dims);
    this.matrix = newMatrix;
    this.ids.push(entryId);
  }

  /**
   * Mark the index as needing rebuild (e.g., after a delete or update).
   */
  invalidate(): void {
    this.dirty = true;
  }

  get needsRebuild(): boolean {
    return this.dirty;
  }

  get size(): number {
    return this.ids.length;
  }

  /**
   * Search the index for the top-K most similar vectors.
   * Uses the contiguous matrix for cache-friendly access.
   */
  search(query: Float32Array, topK: number = 10): VectorResult[] {
    if (this.matrix === null || this.ids.length === 0) return [];

    if (query.length !== this.dims) {
      throw new Error(`Query dimension mismatch: index has ${this.dims}, got ${query.length}`);
    }

    const n = this.ids.length;
    const scores: VectorResult[] = new Array(n);

    // Pre-compute query norm
    let queryNorm = 0;
    for (let j = 0; j < this.dims; j++) {
      queryNorm += query[j] * query[j];
    }
    queryNorm = Math.sqrt(queryNorm);
    if (queryNorm === 0) return [];

    // Compute cosine similarity against the flat matrix
    for (let i = 0; i < n; i++) {
      const offset = i * this.dims;
      let dot = 0;
      let norm = 0;
      for (let j = 0; j < this.dims; j++) {
        const v = this.matrix![offset + j];
        dot += query[j] * v;
        norm += v * v;
      }
      const denom = queryNorm * Math.sqrt(norm);
      scores[i] = {
        entryId: this.ids[i],
        score: denom === 0 ? 0 : dot / denom,
      };
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
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

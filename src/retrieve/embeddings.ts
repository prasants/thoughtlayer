/**
 * Embedding Client
 *
 * BYOLLM: supports OpenAI, Ollama (local), and OpenAI-compatible APIs.
 *
 * Providers:
 * - openai: OpenAI text-embedding-3-small (1536 dims, remote)
 * - ollama: Local Ollama server, default model nomic-embed-text (768 dims)
 * - Auto-detect: tries Ollama first, falls back to OpenAI
 */

import { createHash } from 'crypto';

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  readonly model: string;
  readonly dimensions: number;
}

/**
 * Simple LRU cache for embeddings.
 * Keys: SHA-256 hash of input text. Values: Float32Array embeddings.
 */
export class EmbeddingCache {
  private map = new Map<string, Float32Array>();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  static hashKey(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  get(key: string): Float32Array | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: string, value: Float32Array): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first key)
      const firstKey = this.map.keys().next().value!;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly model = 'text-embedding-3-small';
  readonly dimensions = 1536;
  private apiKey: string;
  private baseUrl: string;
  private cache: EmbeddingCache;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://api.openai.com/v1';
    this.cache = new EmbeddingCache(1000);
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Check cache for each text
    const results = new Array<Float32Array | null>(texts.length).fill(null);
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const key = EmbeddingCache.hashKey(texts[i]);
      const cached = this.cache.get(key);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    // If all cached, return immediately
    if (uncachedTexts.length === 0) {
      return results as Float32Array[];
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Connection': 'keep-alive',
      },
      body: JSON.stringify({
        model: this.model,
        input: uncachedTexts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    data.data.sort((a, b) => a.index - b.index);
    const embeddings = data.data.map(d => new Float32Array(d.embedding));

    // Store in cache and fill results
    for (let i = 0; i < uncachedTexts.length; i++) {
      const key = EmbeddingCache.hashKey(uncachedTexts[i]);
      this.cache.set(key, embeddings[i]);
      results[uncachedIndices[i]] = embeddings[i];
    }

    return results as Float32Array[];
  }

  /** Expose cache size for testing/monitoring. */
  get cacheSize(): number { return this.cache.size; }
}

/**
 * Ollama local embedding provider.
 *
 * Uses the /api/embed endpoint (Ollama 0.4+).
 * Default model: nomic-embed-text (768 dimensions, best open-source embedding model).
 */
export class OllamaEmbeddings implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private baseUrl: string;
  private cache: EmbeddingCache;
  private warmupPromise?: Promise<void>;

  // Known model dimensions
  private static MODEL_DIMS: Record<string, number> = {
    'nomic-embed-text': 768,
    'mxbai-embed-large': 1024,
    'all-minilm': 384,
    'snowflake-arctic-embed': 1024,
    'bge-large': 1024,
    'bge-m3': 1024,
  };

  constructor(model?: string, baseUrl?: string) {
    this.model = model ?? 'nomic-embed-text';
    this.baseUrl = baseUrl ?? 'http://localhost:11434';
    this.dimensions = OllamaEmbeddings.MODEL_DIMS[this.model] ?? 768;
    this.cache = new EmbeddingCache(1000);

    // Fire-and-forget warmup
    this.warmupPromise = this.warmup();
  }

  /**
   * Warm up Ollama by sending a tiny embedding request to force model loading.
   * Non-blocking, errors are silently caught.
   */
  async warmup(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: ['warmup'],
          keep_alive: '5m',
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      // Silently ignore warmup failures
    }
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Check cache for each text
    const results = new Array<Float32Array | null>(texts.length).fill(null);
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const key = EmbeddingCache.hashKey(texts[i]);
      const cached = this.cache.get(key);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    if (uncachedTexts.length === 0) {
      return results as Float32Array[];
    }

    // Ollama /api/embed supports batch via input array (0.4+)
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: uncachedTexts,
        keep_alive: '5m',
      }),
    });

    if (!response.ok) {
      const error = await response.text();

      // Check if model needs to be pulled
      if (response.status === 404 || error.includes('not found')) {
        throw new Error(
          `Ollama model '${this.model}' not found. Pull it first:\n` +
          `  ollama pull ${this.model}`
        );
      }

      throw new Error(`Ollama embedding error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      embeddings: number[][];
    };

    const embeddings = data.embeddings.map(e => new Float32Array(e));

    // Store in cache and fill results
    for (let i = 0; i < uncachedTexts.length; i++) {
      const key = EmbeddingCache.hashKey(uncachedTexts[i]);
      this.cache.set(key, embeddings[i]);
      results[uncachedIndices[i]] = embeddings[i];
    }

    return results as Float32Array[];
  }

  /** Expose cache size for testing/monitoring. */
  get cacheSize(): number { return this.cache.size; }

  /**
   * Check if Ollama is running and the model is available.
   */
  static async isAvailable(baseUrl?: string, model?: string): Promise<boolean> {
    const url = baseUrl ?? 'http://localhost:11434';
    const modelName = model ?? 'nomic-embed-text';

    try {
      // Check server
      const resp = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!resp.ok) return false;

      const data = await resp.json() as { models?: Array<{ name: string }> };
      if (!data.models) return false;

      // Check if model is pulled
      return data.models.some(m =>
        m.name === modelName || m.name.startsWith(`${modelName}:`)
      );
    } catch {
      return false;
    }
  }
}

/**
 * Create an embedding provider from config.
 */
export function createEmbeddingProvider(config: {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) throw new Error('OpenAI API key required for embeddings');
      return new OpenAIEmbeddings(config.apiKey, config.baseUrl);
    case 'ollama':
      return new OllamaEmbeddings(config.model, config.baseUrl);
    default:
      throw new Error(
        `Unsupported embedding provider: ${config.provider}. Supported: openai, ollama`
      );
  }
}

/**
 * Auto-detect the best available embedding provider.
 * Tries Ollama first (local, free, fast), falls back to OpenAI.
 */
export async function autoDetectEmbeddingProvider(config?: {
  ollamaUrl?: string;
  ollamaModel?: string;
  openaiKey?: string;
  openaiUrl?: string;
}): Promise<EmbeddingProvider | null> {
  // Try Ollama first
  const ollamaUrl = config?.ollamaUrl ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const ollamaModel = config?.ollamaModel ?? process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

  if (await OllamaEmbeddings.isAvailable(ollamaUrl, ollamaModel)) {
    return new OllamaEmbeddings(ollamaModel, ollamaUrl);
  }

  // Fall back to OpenAI
  const openaiKey = config?.openaiKey ?? process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return new OpenAIEmbeddings(openaiKey, config?.openaiUrl);
  }

  return null;
}

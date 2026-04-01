/**
 * ThoughtLayer Error Types
 *
 * Custom error classes for better debugging and error handling.
 * All errors extend ThoughtLayerError for easy catch-all patterns.
 */

export class ThoughtLayerError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = 'ThoughtLayerError';
  }
}

/** Errors from embedding providers (OpenAI, Ollama). */
export class EmbeddingError extends ThoughtLayerError {
  constructor(message: string, public readonly provider?: string, context?: Record<string, unknown>) {
    super(message, { provider, ...context });
    this.name = 'EmbeddingError';
  }
}

/** Errors from the storage layer (SQLite, file I/O). */
export class StorageError extends ThoughtLayerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = 'StorageError';
  }
}

/** Errors from query processing and retrieval. */
export class QueryError extends ThoughtLayerError {
  constructor(message: string, public readonly query?: string, context?: Record<string, unknown>) {
    super(message, { query, ...context });
    this.name = 'QueryError';
  }
}

/** Errors from configuration and initialisation. */
export class ConfigError extends ThoughtLayerError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
    this.name = 'ConfigError';
  }
}

/** Errors from the reranking pipeline. */
export class RerankError extends ThoughtLayerError {
  constructor(message: string, public readonly provider?: string, context?: Record<string, unknown>) {
    super(message, { provider, ...context });
    this.name = 'RerankError';
  }
}

/** Errors from codec encoding/decoding. */
export class CodecError extends ThoughtLayerError {
  constructor(message: string, public readonly codec?: string, context?: Record<string, unknown>) {
    super(message, { codec, ...context });
    this.name = 'CodecError';
  }
}

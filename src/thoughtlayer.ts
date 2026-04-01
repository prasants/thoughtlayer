/**
 * ThoughtLayer: High-level API
 *
 * Single entry point that wires storage, retrieval, and ingestion together.
 */

import fs from 'fs';
import path from 'path';
import { ThoughtLayerDatabase, type CreateEntryInput, type KnowledgeEntry, type SearchOptions } from './storage/database.js';
import { retrieve, invalidateVectorIndex, type RetrievalResult, type RetrievalOptions } from './retrieve/pipeline.js';
import { createEmbeddingProvider, autoDetectEmbeddingProvider, EmbeddingCache, type EmbeddingProvider } from './retrieve/embeddings.js';
import { createCurateProvider, type LLMProvider, type CurateResult } from './ingest/curate.js';
import { extractEnrichmentKeywords } from './ingest/enrich.js';
import { needsChunking, chunkContent, chunkTitle } from './ingest/chunk.js';
import { extract, learnFromConversation, type ExtractConfig, type ExtractionResult } from './ingest/auto-extract.js';
import { extractRelationships } from './ingest/relationships.js';
import { PluginRegistry, type ThoughtLayerPlugin } from './plugins.js';

export interface ThoughtLayerConfig {
  projectRoot: string;
  embedding?: {
    provider: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  curate?: {
    provider: string;
    apiKey: string;
    model?: string;
    baseUrl?: string;
  };
}

export class ThoughtLayer {
  private db: ThoughtLayerDatabase;
  private embedder?: EmbeddingProvider;
  private curator?: LLMProvider;
  private config: ThoughtLayerConfig;
  private queryEmbeddingCache: EmbeddingCache;
  private plugins: PluginRegistry = new PluginRegistry();

  /** Expose database for ingestion tracking. */
  get database(): ThoughtLayerDatabase { return this.db; }

  constructor(config: ThoughtLayerConfig) {
    this.config = config;
    this.db = new ThoughtLayerDatabase(config.projectRoot);
    this.queryEmbeddingCache = new EmbeddingCache(100);

    if (config.embedding) {
      this.embedder = createEmbeddingProvider(config.embedding);
    }

    if (config.curate) {
      this.curator = createCurateProvider(config.curate);
    }
  }

  /**
   * Curate: ingest raw text, extract knowledge, store with embeddings.
   */
  async curate(text: string, options?: { domain?: string }): Promise<{
    entries: KnowledgeEntry[];
    result: CurateResult;
  }> {
    if (!this.curator) {
      throw new Error('No curate provider configured. Set curate config or use add() for manual entries.');
    }

    // Get existing domains for context
    const health = this.db.health();
    const existingDomains = Object.keys(health.domains);

    // LLM extracts structured knowledge
    const result = await this.curator.curate(text, existingDomains);

    const entries: KnowledgeEntry[] = [];

    for (const op of result.operations) {
      if (op.action === 'DELETE') {
        if (op.mergeTargetId) {
          this.db.archive(op.mergeTargetId);
        }
        continue;
      }

      const baseKeywords = op.keywords ?? [];
      const enrichedKeywords = extractEnrichmentKeywords(
        op.title,
        op.content,
        baseKeywords
      );
      const input: CreateEntryInput = {
        domain: options?.domain ?? op.domain,
        topic: op.topic,
        subtopic: op.subtopic,
        title: op.title,
        content: op.content,
        summary: op.summary,
        facts: op.facts,
        tags: op.tags,
        keywords: [...baseKeywords, ...enrichedKeywords],
        importance: op.importance,
        confidence: op.confidence,
        source_type: 'conversation',
      };

      if (op.action === 'UPDATE' && op.mergeTargetId) {
        const updated = this.db.update(op.mergeTargetId, input);
        if (updated) {
          if (this.embedder) {
            const embedding = await this.embedder.embed(
              `${updated.title}\n${updated.content}`
            );
            this.db.storeEmbedding(updated.id, embedding, this.embedder.model);
          }
          entries.push(updated);
        }
      } else {
        // ADD or MERGE (treat MERGE as ADD for Phase 0)
        const entry = this.db.create(input);

        if (this.embedder) {
          const embedding = await this.embedder.embed(
            `${entry.title}\n${entry.content}`
          );
          this.db.storeEmbedding(entry.id, embedding, this.embedder.model);
        }

        entries.push(entry);
      }
    }

    return { entries, result };
  }

  /**
   * Add a manual entry (no LLM needed).
   */
  async add(input: CreateEntryInput): Promise<KnowledgeEntry> {
    // Auto-chunk large documents
    if (needsChunking(input.content)) {
      const chunks = chunkContent(input.content);
      const chunkEntries: KnowledgeEntry[] = [];

      for (const chunk of chunks) {
        const title = chunkTitle(input.title, chunk.index, chunk.total);
        const enrichedKeywords = extractEnrichmentKeywords(
          title,
          chunk.content,
          input.keywords ?? []
        );
        const chunkInput = {
          ...input,
          title,
          content: chunk.content,
          keywords: [...(input.keywords ?? []), ...enrichedKeywords],
        };
        const entry = this.db.create(chunkInput);

        if (this.embedder) {
          const embedding = await this.embedder.embed(
            `${entry.title}\n${entry.content}`
          );
          this.db.storeEmbedding(entry.id, embedding, this.embedder.model);
        }
        chunkEntries.push(entry);
      }

      // Create parent entry with metadata linking to chunks
      const parentInput = {
        ...input,
        keywords: [...(input.keywords ?? []), ...extractEnrichmentKeywords(input.title, input.content, input.keywords ?? [])],
        summary: `Auto-chunked into ${chunks.length} parts. Content exceeds embedding limit.`,
        relations: [
          ...(input.relations ?? []),
          ...chunkEntries.map(e => ({ target_id: e.id, type: 'has_chunk', strength: 1.0 })),
        ],
      };
      const parent = this.db.create(parentInput);
      return parent;
    }

    // Normal path: enrich keywords and store
    const enrichedKeywords = extractEnrichmentKeywords(
      input.title,
      input.content,
      input.keywords ?? []
    );
    const enrichedInput = {
      ...input,
      keywords: [...(input.keywords ?? []), ...enrichedKeywords],
    };
    const entry = this.db.create(enrichedInput);

    // Extract and store knowledge graph relationships
    const relationships = extractRelationships(entry.content, entry.title);
    for (const rel of relationships) {
      this.db.storeRelationship(entry.id, rel.subject, rel.predicate, rel.object, rel.confidence);
    }

    if (this.embedder) {
      try {
        const embedding = await this.embedder.embed(
          `${entry.title}\n${entry.content}`
        );
        this.db.storeEmbedding(entry.id, embedding, this.embedder.model);
        invalidateVectorIndex(this.db);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('not found')) {
          console.error(`⚠️  Entry saved, but embedding failed: ${this.embedder.model} is not reachable.`);
          console.error(`   If using Ollama, make sure it is running: ollama serve`);
          console.error(`   If using OpenAI, check your OPENAI_API_KEY is set.`);
        } else {
          throw err;
        }
      }
    }

    return entry;
  }

  /**
   * Add multiple entries in batch with batch embedding support.
   * Significantly faster than calling add() in a loop when using remote embedding APIs.
   */
  async addBatch(inputs: CreateEntryInput[]): Promise<KnowledgeEntry[]> {
    const entries: KnowledgeEntry[] = [];
    const textsToEmbed: string[] = [];
    const entryIds: string[] = [];

    // First pass: create all entries in the database
    for (const input of inputs) {
      const enrichedKeywords = extractEnrichmentKeywords(
        input.title,
        input.content,
        input.keywords ?? []
      );
      const enrichedInput = {
        ...input,
        keywords: [...(input.keywords ?? []), ...enrichedKeywords],
      };
      const entry = this.db.create(enrichedInput);

      // Extract and store knowledge graph relationships
      const relationships = extractRelationships(entry.content, entry.title);
      for (const rel of relationships) {
        this.db.storeRelationship(entry.id, rel.subject, rel.predicate, rel.object, rel.confidence);
      }

      entries.push(entry);
      textsToEmbed.push(`${entry.title}\n${entry.content}`);
      entryIds.push(entry.id);
    }

    // Second pass: batch embed all entries
    if (this.embedder && textsToEmbed.length > 0) {
      try {
        // Process in chunks to respect API rate limits
        const BATCH_SIZE = 100;
        for (let i = 0; i < textsToEmbed.length; i += BATCH_SIZE) {
          const batchTexts = textsToEmbed.slice(i, i + BATCH_SIZE);
          const batchIds = entryIds.slice(i, i + BATCH_SIZE);
          const embeddings = await this.embedder.embedBatch(batchTexts);

          for (let j = 0; j < embeddings.length; j++) {
            this.db.storeEmbedding(batchIds[j], embeddings[j], this.embedder.model);
          }
        }
        invalidateVectorIndex(this.db);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('not found')) {
          console.error(`⚠️  Entries saved, but batch embedding failed: ${this.embedder.model} is not reachable.`);
        } else {
          throw err;
        }
      }
    }

    return entries;
  }

  /**
   * Query: semantic search + keyword search + freshness decay.
   */
  async query(query: string, options?: Partial<RetrievalOptions>): Promise<RetrievalResult[]> {
    let queryEmbedding: Float32Array | undefined;

    if (this.embedder) {
      try {
        const cacheKey = EmbeddingCache.hashKey(query);
        const cached = this.queryEmbeddingCache.get(cacheKey);
        if (cached) {
          queryEmbedding = cached;
        } else {
          queryEmbedding = await this.embedder.embed(query);
          this.queryEmbeddingCache.set(cacheKey, queryEmbedding);
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('not found')) {
          console.error(`⚠️  Embedding provider not reachable. Falling back to keyword search only.`);
          console.error(`   If using Ollama, make sure it is running: ollama serve`);
        } else {
          throw err;
        }
      }
    }

    return retrieve(this.db, {
      query,
      queryEmbedding,
      ...options,
    });
  }

  /**
   * Search: uses the full retrieval pipeline without requiring embeddings.
   * Same quality as query() but works without an embedding provider configured.
   */
  async search(query: string, limit?: number): Promise<RetrievalResult[]> {
    return retrieve(this.db, {
      query,
      topK: limit ?? 10,
    });
  }

  /**
   * Raw FTS5 search (BM25 only, no pipeline). For internal/debug use.
   */
  searchRaw(query: string, limit?: number) {
    return this.db.searchFTS(query, limit);
  }

  /**
   * List entries with filters.
   */
  list(options?: SearchOptions) {
    return this.db.list(options);
  }

  /**
   * Get a single entry by ID.
   */
  get(id: string) {
    return this.db.getById(id);
  }

  /**
   * Update an entry.
   */
  async update(id: string, updates: Partial<CreateEntryInput>) {
    const updated = this.db.update(id, updates);

    if (updated && this.embedder && (updates.content || updates.title)) {
      const embedding = await this.embedder.embed(
        `${updated.title}\n${updated.content}`
      );
      this.db.storeEmbedding(updated.id, embedding, this.embedder.model);
    }

    return updated;
  }

  /**
   * Archive an entry.
   */
  archive(id: string) {
    return this.db.archive(id);
  }

  /**
   * Knowledge health metrics.
   */
  health() {
    return this.db.health();
  }

  /**
   * Entry count.
   */
  count() {
    return this.db.count();
  }

  /**
   * Register a plugin for lifecycle hooks.
   */
  use(plugin: ThoughtLayerPlugin): void {
    this.plugins.use(plugin);
  }

  /**
   * Remove a plugin by name.
   */
  removePlugin(name: string): boolean {
    return this.plugins.remove(name);
  }

  /**
   * Run database optimisation (VACUUM, FTS optimize, PRAGMA optimize).
   */
  optimize() {
    return this.db.optimize();
  }

  /**
   * Get persistent embedding cache statistics.
   */
  cacheStats() {
    return this.db.embeddingCacheStats();
  }

  /**
   * Clear the persistent embedding cache.
   */
  clearCache() {
    this.db.clearEmbeddingCache();
  }

  /**
   * Close database.
   */
  close() {
    this.db.close();
  }

  /**
   * Learn from a conversation turn.
   *
   * Automatically extracts memorable facts, decisions, and preferences
   * from a user message and assistant response, then stores them.
   *
   * This is the "magic" that makes memory feel automatic: users don't
   * have to manually add knowledge, the system learns from conversations.
   *
   * @example
   * ```typescript
   * const { added, extracted } = await memory.learn(
   *   "What database should we use?",
   *   "I recommend PostgreSQL with pgvector for its excellent vector search support."
   * );
   * console.log(`Learned ${added} facts from this conversation`);
   * ```
   */
  async learn(
    userMessage: string,
    assistantResponse: string,
    config?: ExtractConfig
  ): Promise<{ added: number; extracted: ExtractionResult }> {
    const extracted = await learnFromConversation(userMessage, assistantResponse, config);

    let added = 0;
    for (const entryInput of extracted.entries) {
      await this.add(entryInput);
      added++;
    }

    return { added, extracted };
  }

  /**
   * Extract and store memories from arbitrary text.
   *
   * Like `learn()` but for any text, not just conversations.
   * Useful for processing meeting notes, documents, or any content
   * that might contain memorable information.
   */
  async extractAndStore(
    text: string,
    config?: ExtractConfig
  ): Promise<{ added: number; extracted: ExtractionResult }> {
    const extracted = await extract(text, config);

    let added = 0;
    for (const entryInput of extracted.entries) {
      await this.add(entryInput);
      added++;
    }

    return { added, extracted };
  }

  /**
   * Initialise a new ThoughtLayer project.
   */
  static init(projectRoot: string, config?: Partial<ThoughtLayerConfig>): ThoughtLayer {
    const thoughtlayerDir = path.join(projectRoot, '.thoughtlayer');
    const configPath = path.join(thoughtlayerDir, 'config.json');

    fs.mkdirSync(thoughtlayerDir, { recursive: true });

    const defaultConfig: ThoughtLayerConfig = {
      projectRoot,
      ...config,
    };

    // Write config (without API keys, those come from env)
    const safeConfig = {
      version: 1,
      embedding: defaultConfig.embedding ? {
        provider: defaultConfig.embedding.provider,
      } : undefined,
      curate: defaultConfig.curate ? {
        provider: defaultConfig.curate.provider,
        model: defaultConfig.curate.model,
      } : undefined,
    };

    fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), 'utf-8');

    return new ThoughtLayer(defaultConfig);
  }

  /**
   * Load existing ThoughtLayer project.
   */
  static load(projectRoot: string): ThoughtLayer {
    const configPath = path.join(projectRoot, '.thoughtlayer', 'config.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(`No ThoughtLayer project found at ${projectRoot}. Run 'thoughtlayer init' first.`);
    }

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    const config: ThoughtLayerConfig = {
      projectRoot,
    };

    // Load embedding config from environment
    if (savedConfig.embedding?.provider === 'ollama') {
      config.embedding = {
        provider: 'ollama',
        model: savedConfig.embedding.model,
        baseUrl: process.env.OLLAMA_HOST,
      };
    } else if (savedConfig.embedding?.provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey) {
        config.embedding = {
          provider: 'openai',
          apiKey,
        };
      }
    }

    if (savedConfig.curate?.provider === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        config.curate = {
          provider: 'anthropic',
          apiKey,
          model: savedConfig.curate.model,
        };
      }
    } else if (savedConfig.curate?.provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey) {
        config.curate = {
          provider: 'openai',
          apiKey,
          model: savedConfig.curate.model,
        };
      }
    }

    return new ThoughtLayer(config);
  }

  /**
   * Load with auto-detection of embedding provider.
   * Tries Ollama first (local, free, fast), falls back to OpenAI if configured.
   * This is the recommended way to load ThoughtLayer for real-world use.
   */
  static async loadWithAutoDetect(projectRoot: string): Promise<ThoughtLayer> {
    const base = ThoughtLayer.load(projectRoot);
    
    // If embeddings already configured, return as-is
    if (base.embedder) {
      return base;
    }
    
    // Auto-detect embedding provider
    const embedder = await autoDetectEmbeddingProvider();
    if (embedder) {
      // @ts-ignore - setting private field for auto-detect
      base.embedder = embedder;
      console.error(`[ThoughtLayer] Auto-detected embeddings: ${embedder.model} (${embedder.dimensions}d)`);
    }
    
    return base;
  }

  /**
   * Rebuild all entries: re-run enrichment and regenerate embeddings.
   * Use when enrichment logic changes or embedding model switches.
   */
  async rebuild(options?: { onProgress?: (current: number, total: number, title: string) => void }): Promise<{ enriched: number; embedded: number; total: number }> {
    const entries = this.db.list({ limit: 100000 });
    let enriched = 0;
    let embedded = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      options?.onProgress?.(i + 1, entries.length, entry.title);

      // Re-run enrichment on the original content
      const newKeywords = extractEnrichmentKeywords(
        entry.title,
        entry.content,
        [] // Start fresh - don't pass existing enriched keywords
      );

      // Filter out old enriched keywords (keep only user-provided ones)
      // We consider keywords that came from the original input as "base" keywords
      // For simplicity, replace all keywords with freshly enriched ones
      const updated = this.db.update(entry.id, {
        keywords: newKeywords,
      });

      if (updated) enriched++;

      // Regenerate embedding
      if (this.embedder && updated) {
        const embedding = await this.embedder.embed(
          `${updated.title}\n${updated.content}`
        );
        this.db.storeEmbedding(updated.id, embedding, this.embedder.model);
        embedded++;
      }
    }

    return { enriched, embedded, total: entries.length };
  }

  /**
   * Embed all entries that don't have embeddings yet.
   * Returns count of entries embedded.
   */
  async embedAll(): Promise<number> {
    if (!this.embedder) {
      throw new Error('No embedding provider configured. Run with Ollama or set OPENAI_API_KEY.');
    }

    const entries = this.db.list({ limit: 10000 });
    let embedded = 0;

    for (const entry of entries) {
      const existing = this.db.getEmbedding(entry.id);
      if (existing && existing.model === this.embedder.model) {
        continue; // Already has embedding from same model
      }

      const embedding = await this.embedder.embed(
        `${entry.title}\n${entry.content}`
      );
      this.db.storeEmbedding(entry.id, embedding, this.embedder.model);
      embedded++;
    }

    return embedded;
  }

  /**
   * Check if embeddings are available.
   */
  hasEmbeddings(): boolean {
    return !!this.embedder;
  }

  /**
   * Get embedding provider info.
   */
  embeddingInfo(): { model: string; dimensions: number } | null {
    if (!this.embedder) return null;
    return { model: this.embedder.model, dimensions: this.embedder.dimensions };
  }
}

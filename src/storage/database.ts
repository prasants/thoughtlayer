/**
 * ThoughtLayer Database
 *
 * SQLite storage layer with FTS5 and vector support.
 * All writes go through here; Markdown files are generated as a readable mirror.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { v7 as uuidv7 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { CREATE_TABLES, SCHEMA_VERSION } from './schema.js';
import { runMigrations } from './migrations.js';
import { EmbeddingCodec, RawCodec, Int8Codec, getCodec } from '../retrieve/codec.js';

export interface KnowledgeEntry {
  id: string;
  project_id: string;
  version: number;
  domain: string;
  topic: string | null;
  subtopic: string | null;
  title: string;
  content: string;
  content_hash: string;
  summary: string | null;
  facts: string[];
  tags: string[];
  keywords: string[];
  relations: Relation[];
  source_type: string;
  source_ref: string | null;
  importance: number;
  confidence: number;
  freshness_at: string;
  access_count: number;
  last_accessed_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Relation {
  target_id: string;
  type: string;
  strength: number;
}

export interface CreateEntryInput {
  domain: string;
  topic?: string;
  subtopic?: string;
  title: string;
  content: string;
  summary?: string;
  facts?: string[];
  tags?: string[];
  keywords?: string[];
  relations?: Relation[];
  source_type?: string;
  source_ref?: string;
  importance?: number;
  confidence?: number;
}

export interface SearchOptions {
  domain?: string;
  topic?: string;
  tags?: string[];
  status?: string;
  minImportance?: number;
  limit?: number;
  offset?: number;
}

export class ThoughtLayerDatabase {
  private db: Database.Database;
  private projectRoot: string;
  private knowledgeDir: string;
  private codec: EmbeddingCodec;

  constructor(projectRoot: string, codecName?: string) {
    this.projectRoot = projectRoot;
    const thoughtlayerDir = path.join(projectRoot, '.thoughtlayer');
    const indexDir = path.join(thoughtlayerDir, 'index');
    this.knowledgeDir = path.join(thoughtlayerDir, 'knowledge');

    // Ensure directories exist
    fs.mkdirSync(indexDir, { recursive: true });
    fs.mkdirSync(this.knowledgeDir, { recursive: true });

    // Open database
    const dbPath = path.join(indexDir, 'metadata.db');
    this.db = new Database(dbPath);

    // Performance settings
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('busy_timeout = 5000');

    // Initialise schema
    this.db.exec(CREATE_TABLES);
    this.setSchemaVersion();

    // Run pending migrations
    runMigrations(this.db);

    // Resolve embedding codec
    const storedCodec = this.getConfigValue('embedding_codec');
    const resolvedCodec = codecName ?? storedCodec ?? 'raw';
    this.codec = getCodec(resolvedCodec);
    if (codecName && codecName !== storedCodec) {
      this.setConfigValue('embedding_codec', codecName);
    }
  }

  private setSchemaVersion(): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)'
    );
    stmt.run('version', String(SCHEMA_VERSION));
  }

  private getConfigValue(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM schema_info WHERE key = ?').get(key) as any;
    return row?.value ?? null;
  }

  private setConfigValue(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)').run(key, value);
  }

  /** Current codec name. */
  get codecName(): string { return this.codec.name; }

  /**
   * Create a new knowledge entry.
   * Writes to SQLite (FTS auto-synced via triggers) and generates Markdown file.
   */
  create(input: CreateEntryInput): KnowledgeEntry {
    const id = uuidv7();
    const contentHash = createHash('sha256').update(input.content).digest('hex');
    const now = new Date().toISOString();

    // Dedup: check if content with same hash and title already exists
    const existing = this.db.prepare(
      "SELECT * FROM entries WHERE content_hash = ? AND title = ? AND status = 'active'"
    ).get(contentHash, input.title) as any;
    if (existing) {
      return this.rowToEntry(existing);
    }

    const entry: KnowledgeEntry = {
      id,
      project_id: 'default',
      version: 1,
      domain: input.domain,
      topic: input.topic ?? null,
      subtopic: input.subtopic ?? null,
      title: input.title,
      content: input.content,
      content_hash: contentHash,
      summary: input.summary ?? null,
      facts: input.facts ?? [],
      tags: input.tags ?? [],
      keywords: input.keywords ?? [],
      relations: input.relations ?? [],
      source_type: input.source_type ?? 'conversation',
      source_ref: input.source_ref ?? null,
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.8,
      freshness_at: now,
      access_count: 0,
      last_accessed_at: null,
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO entries (
        id, project_id, version, domain, topic, subtopic, title,
        content, content_hash, summary, facts, tags, keywords, relations,
        source_type, source_ref, importance, confidence, freshness_at,
        access_count, last_accessed_at, status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      entry.id, entry.project_id, entry.version,
      entry.domain, entry.topic, entry.subtopic, entry.title,
      entry.content, entry.content_hash, entry.summary,
      JSON.stringify(entry.facts), JSON.stringify(entry.tags),
      JSON.stringify(entry.keywords), JSON.stringify(entry.relations),
      entry.source_type, entry.source_ref,
      entry.importance, entry.confidence, entry.freshness_at,
      entry.access_count, entry.last_accessed_at,
      entry.status, entry.created_at, entry.updated_at
    );

    // Log event
    this.logEvent(id, 'created', { title: entry.title, domain: entry.domain });

    // Write Markdown file
    this.writeMarkdown(entry);

    return entry;
  }

  /**
   * Update an existing entry.
   */
  update(id: string, updates: Partial<CreateEntryInput>): KnowledgeEntry | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const newContent = updates.content ?? existing.content;
    const contentHash = createHash('sha256').update(newContent).digest('hex');

    const stmt = this.db.prepare(`
      UPDATE entries SET
        domain = ?, topic = ?, subtopic = ?, title = ?,
        content = ?, content_hash = ?, summary = ?,
        facts = ?, tags = ?, keywords = ?, relations = ?,
        importance = ?, confidence = ?,
        version = version + 1,
        freshness_at = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updates.domain ?? existing.domain,
      updates.topic ?? existing.topic,
      updates.subtopic ?? existing.subtopic,
      updates.title ?? existing.title,
      newContent, contentHash,
      updates.summary ?? existing.summary,
      JSON.stringify(updates.facts ?? existing.facts),
      JSON.stringify(updates.tags ?? existing.tags),
      JSON.stringify(updates.keywords ?? existing.keywords),
      JSON.stringify(updates.relations ?? existing.relations),
      updates.importance ?? existing.importance,
      updates.confidence ?? existing.confidence,
      now, now, id
    );

    this.logEvent(id, 'updated', { fields: Object.keys(updates) });

    const updated = this.getById(id)!;
    this.writeMarkdown(updated);
    return updated;
  }

  /**
   * Get entry by ID.
   */
  getById(id: string): KnowledgeEntry | null {
    const row = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  /**
   * List entries with filters.
   */
  list(options: SearchOptions = {}): KnowledgeEntry[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.domain) {
      conditions.push('domain = ?');
      params.push(options.domain);
    }
    if (options.topic) {
      conditions.push('topic = ?');
      params.push(options.topic);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    } else {
      conditions.push("status = 'active'");
    }
    if (options.minImportance !== undefined) {
      conditions.push('importance >= ?');
      params.push(options.minImportance);
    }
    if (options.tags && options.tags.length > 0) {
      for (const tag of options.tags) {
        conditions.push("tags LIKE ?");
        params.push(`%"${tag}"%`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const rows = this.db.prepare(
      `SELECT * FROM entries ${where} ORDER BY importance DESC, freshness_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    return rows.map(r => this.rowToEntry(r));
  }

  /**
   * Full-text search using FTS5 with BM25 ranking.
   *
   * Converts natural language queries to FTS5 OR syntax with stopword removal.
   * FTS5 default is AND (all terms must match), which kills recall for
   * conversational queries like "What database are we using and why?"
   */
  searchFTS(query: string, limit: number = 10): Array<KnowledgeEntry & { rank: number }> {
    // Sanitise: remove special characters, hyphens
    const sanitised = query
      .replace(/[?!@#$%^&*()+=\[\]{};:'",.<>/\\|`~]/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitised) return [];

    // Remove stopwords and build OR query for better recall
    const stopwords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'to', 'of', 'in',
      'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
      'during', 'before', 'after', 'between', 'out', 'off', 'over', 'under',
      'again', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
      'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
      'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
      'too', 'very', 'just', 'now', 'about', 'what', 'which', 'who', 'whom',
      'this', 'that', 'these', 'those', 'am', 'but', 'if', 'or', 'because',
      'until', 'while', 'and', 'it', 'i', 'me', 'my', 'we', 'our', 'you',
      'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
      's', 't', 'don', 've', 'll', 're', 'd', 'm',
      'any', 'every', 'best', 'tell',
    ]);

    const allWords = sanitised.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    let terms = allWords.filter(w => !stopwords.has(w));

    // Short query handling: if stripping stopwords leaves ≤1 term,
    // keep all words ≥3 chars to preserve meaning
    if (terms.length <= 1 && allWords.length > terms.length) {
      terms = allWords.filter(w => w.length >= 3);
    }

    if (terms.length === 0) return [];

    // Strategy: run two FTS queries and merge results.
    // 1. AND query (all terms must match): high precision
    // 2. OR query (any term can match): high recall
    // AND matches get a significant rank boost.

    // Escape FTS5 special tokens by double-quoting each term
    const escaped = terms.map(t => '"' + t.replace(/"/g, '""') + '"');
    const andQuery = escaped.join(' AND ');
    const orQuery = escaped.join(' OR ');

    const resultMap = new Map<string, { entry: KnowledgeEntry & { rank: number } }>();

    // bm25 weights: title=10, content=1, tags=3, keywords=3, domain=2, topic=2
    const bm25Weights = '10.0, 1.0, 3.0, 3.0, 2.0, 2.0';

    // AND query first (high-precision matches)
    try {
      const andRows = this.db.prepare(`
        SELECT entries.*, bm25(entries_fts, ${bm25Weights}) as rank
        FROM entries_fts
        JOIN entries ON entries.rowid = entries_fts.rowid
        WHERE entries_fts MATCH ?
          AND entries.status = 'active'
        ORDER BY rank
        LIMIT ?
      `).all(andQuery, limit) as any[];

      for (const r of andRows) {
        const entry = this.rowToEntry(r);
        // AND matches get 3x boost (lower rank = better, so multiply by 3)
        resultMap.set(entry.id, { entry: { ...entry, rank: r.rank * 3 } });
      }
    } catch {
      // AND query can fail if terms produce invalid FTS5 syntax
    }

    // OR query for recall
    try {
      const orRows = this.db.prepare(`
        SELECT entries.*, bm25(entries_fts, ${bm25Weights}) as rank
        FROM entries_fts
        JOIN entries ON entries.rowid = entries_fts.rowid
        WHERE entries_fts MATCH ?
          AND entries.status = 'active'
        ORDER BY rank
        LIMIT ?
      `).all(orQuery, limit) as any[];

      for (const r of orRows) {
        const entry = this.rowToEntry(r);
        if (!resultMap.has(entry.id)) {
          resultMap.set(entry.id, { entry: { ...entry, rank: r.rank } });
        }
        // If already present from AND query, keep the AND boost (better rank)
      }
    } catch {
      // OR query fallback
    }

    // Sort by rank (lower = better) and return top results
    const results = [...resultMap.values()]
      .sort((a, b) => a.entry.rank - b.entry.rank)
      .slice(0, limit)
      .map(r => r.entry);

    return results;
  }

  /**
   * Store embedding for an entry.
   */
  storeEmbedding(entryId: string, embedding: Float32Array, model: string): void {
    const id = uuidv7();
    const buffer = this.codec.encode(embedding);

    this.db.prepare(`
      INSERT INTO embeddings (id, entry_id, embedding, model, dimensions, codec)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, entryId, buffer, model, embedding.length, this.codec.name);
  }

  /**
   * Get embedding for an entry.
   */
  getEmbedding(entryId: string): { embedding: Float32Array; model: string } | null {
    const row = this.db.prepare(
      'SELECT embedding, model, dimensions, codec FROM embeddings WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(entryId) as any;

    if (!row) return null;

    const rowCodec = getCodec(row.codec ?? 'raw');
    return { embedding: rowCodec.decode(row.embedding), model: row.model };
  }

  /**
   * Get all embeddings (for vector search).
   */
  getAllEmbeddings(): Array<{ entryId: string; embedding: Float32Array }> {
    const rows = this.db.prepare(
      'SELECT entry_id, embedding, dimensions, codec FROM embeddings ORDER BY created_at DESC'
    ).all() as any[];

    return rows.map(r => {
      const rowCodec = getCodec(r.codec ?? 'raw');
      return {
        entryId: r.entry_id,
        embedding: rowCodec.decode(r.embedding),
      };
    });
  }

  /**
   * Record an access (for freshness/importance tracking).
   */
  recordAccess(id: string): void {
    this.db.prepare(`
      UPDATE entries SET
        access_count = access_count + 1,
        last_accessed_at = datetime('now')
      WHERE id = ?
    `).run(id);
  }

  /**
   * Archive an entry (soft delete).
   */
  archive(id: string): boolean {
    const result = this.db.prepare(
      "UPDATE entries SET status = 'archived', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    if (result.changes > 0) {
      this.logEvent(id, 'archived', {});
    }
    return result.changes > 0;
  }

  /**
   * Get knowledge health stats.
   */
  health(): {
    total: number;
    active: number;
    archived: number;
    stale: number;
    domains: Record<string, number>;
    avgImportance: number;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM entries').get() as any).c;
    const active = (this.db.prepare("SELECT COUNT(*) as c FROM entries WHERE status = 'active'").get() as any).c;
    const archived = (this.db.prepare("SELECT COUNT(*) as c FROM entries WHERE status = 'archived'").get() as any).c;

    // Stale = not accessed in 30 days and freshness > 30 days old
    const stale = (this.db.prepare(`
      SELECT COUNT(*) as c FROM entries
      WHERE status = 'active'
        AND freshness_at < datetime('now', '-30 days')
        AND (last_accessed_at IS NULL OR last_accessed_at < datetime('now', '-30 days'))
    `).get() as any).c;

    const domainRows = this.db.prepare(
      "SELECT domain, COUNT(*) as c FROM entries WHERE status = 'active' GROUP BY domain"
    ).all() as any[];

    const domains: Record<string, number> = {};
    for (const row of domainRows) {
      domains[row.domain] = row.c;
    }

    const avgRow = this.db.prepare(
      "SELECT AVG(importance) as avg FROM entries WHERE status = 'active'"
    ).get() as any;

    return {
      total,
      active,
      archived,
      stale,
      domains,
      avgImportance: avgRow.avg ?? 0,
    };
  }

  /**
   * Get entry count.
   */
  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM entries').get() as any).c;
  }

  /**
   * Compress all embeddings from their current codec to the target codec.
   * Returns { compressed, skipped, savedBytes }.
   */
  compress(targetCodecName: string = 'int8'): { compressed: number; skipped: number; savedBytes: number } {
    const targetCodec = getCodec(targetCodecName);
    const rows = this.db.prepare(
      'SELECT id, entry_id, embedding, dimensions, codec FROM embeddings'
    ).all() as any[];

    let compressed = 0;
    let skipped = 0;
    let savedBytes = 0;

    const updateStmt = this.db.prepare(
      'UPDATE embeddings SET embedding = ?, codec = ? WHERE id = ?'
    );

    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        const currentCodecName = row.codec ?? 'raw';
        if (currentCodecName === targetCodecName) {
          skipped++;
          continue;
        }

        const currentCodec = getCodec(currentCodecName);
        const vec = currentCodec.decode(row.embedding);
        const newBuf = targetCodec.encode(vec);

        const oldSize = (row.embedding as Buffer).length;
        const newSize = newBuf.length;
        savedBytes += oldSize - newSize;

        updateStmt.run(newBuf, targetCodecName, row.id);
        compressed++;
      }

      this.setConfigValue('embedding_codec', targetCodecName);
    });

    transaction();
    this.codec = targetCodec;

    return { compressed, skipped, savedBytes };
  }

  /**
   * Get embedding storage stats.
   */
  embeddingStats(): { count: number; totalBytes: number; codec: string } {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(LENGTH(embedding)), 0) as totalBytes FROM embeddings'
    ).get() as any;
    return { count: row.count, totalBytes: row.totalBytes, codec: this.codec.name };
  }

  /**
   * Close database connection.
   */
  close(): void {
    this.db.close();
  }

  // --- Persistent embedding cache ---

  /**
   * Look up an embedding in the persistent cache.
   */
  getCachedEmbedding(textHash: string, model: string): Float32Array | null {
    const row = this.db.prepare(
      'SELECT embedding, codec FROM embedding_cache WHERE text_hash = ? AND model = ?'
    ).get(textHash, model) as any;

    if (!row) return null;

    // Update last_used_at for LRU tracking
    this.db.prepare(
      "UPDATE embedding_cache SET last_used_at = datetime('now') WHERE text_hash = ? AND model = ?"
    ).run(textHash, model);

    const rowCodec = getCodec(row.codec ?? 'raw');
    return rowCodec.decode(row.embedding);
  }

  /**
   * Store an embedding in the persistent cache.
   */
  setCachedEmbedding(textHash: string, model: string, embedding: Float32Array): void {
    const buffer = this.codec.encode(embedding);
    this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (text_hash, model, embedding, codec, created_at, last_used_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(textHash, model, buffer, this.codec.name);
  }

  /**
   * Get embedding cache statistics.
   */
  embeddingCacheStats(): { count: number; totalBytes: number } {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count, COALESCE(SUM(LENGTH(embedding)), 0) as totalBytes FROM embedding_cache'
    ).get() as any;
    return { count: row.count, totalBytes: row.totalBytes };
  }

  /**
   * Evict oldest entries from the persistent embedding cache.
   */
  evictEmbeddingCache(maxEntries: number = 50000): number {
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM embedding_cache').get() as any).c;
    if (count <= maxEntries) return 0;

    const toEvict = count - maxEntries;
    this.db.prepare(`
      DELETE FROM embedding_cache WHERE rowid IN (
        SELECT rowid FROM embedding_cache ORDER BY last_used_at ASC LIMIT ?
      )
    `).run(toEvict);
    return toEvict;
  }

  /**
   * Clear the persistent embedding cache.
   */
  clearEmbeddingCache(): void {
    this.db.prepare('DELETE FROM embedding_cache').run();
  }

  // --- File ingestion tracking ---

  /**
   * Check if a file has been ingested (by path).
   */
  getIngestedFile(filePath: string): { content_hash: string; entry_id: string; mtime_ms: number } | null {
    const row = this.db.prepare(
      'SELECT content_hash, entry_id, mtime_ms FROM ingested_files WHERE file_path = ?'
    ).get(filePath) as any;
    return row ?? null;
  }

  /**
   * Record a file as ingested.
   */
  trackIngestedFile(filePath: string, contentHash: string, entryId: string, fileSize: number, mtimeMs: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO ingested_files (file_path, content_hash, entry_id, file_size, mtime_ms, ingested_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(filePath, contentHash, entryId, fileSize, mtimeMs);
  }

  /**
   * Remove ingestion tracking for a file.
   */
  untrackIngestedFile(filePath: string): void {
    this.db.prepare('DELETE FROM ingested_files WHERE file_path = ?').run(filePath);
  }

  /**
   * List all tracked ingested files.
   */
  listIngestedFiles(): Array<{ file_path: string; content_hash: string; entry_id: string; mtime_ms: number }> {
    return this.db.prepare('SELECT file_path, content_hash, entry_id, mtime_ms FROM ingested_files').all() as any[];
  }

  // --- Knowledge graph relationships ---

  /**
   * Store a relationship triple linked to an entry.
   */
  storeRelationship(entryId: string, subject: string, predicate: string, object: string, confidence: number): void {
    const id = uuidv7();
    this.db.prepare(`
      INSERT OR IGNORE INTO relationships (id, entry_id, subject, predicate, object, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, entryId, subject, predicate, object, confidence);
  }

  /**
   * Get all relationships for a given entry.
   */
  getRelationships(entryId: string): Array<{ id: string; subject: string; predicate: string; object: string; confidence: number }> {
    return this.db.prepare(
      'SELECT id, subject, predicate, object, confidence FROM relationships WHERE entry_id = ?'
    ).all(entryId) as any[];
  }

  /**
   * Find entries related to an entity name (as subject or object).
   */
  findRelated(entityName: string): Array<{ entry_id: string; subject: string; predicate: string; object: string; confidence: number }> {
    return this.db.prepare(
      'SELECT entry_id, subject, predicate, object, confidence FROM relationships WHERE subject = ? COLLATE NOCASE OR object = ? COLLATE NOCASE'
    ).all(entityName, entityName) as any[];
  }

  /**
   * Traverse the knowledge graph from an entity up to N hops.
   * Returns entry IDs reachable within the given hop count, with a decay factor per hop.
   */
  traverseGraph(entityName: string, hops: number = 2): Map<string, number> {
    const visited = new Map<string, number>(); // entryId -> best score
    const visitedEntities = new Set<string>(); // cycle detection
    let frontier = new Set<string>([entityName.toLowerCase()]);
    visitedEntities.add(entityName.toLowerCase());

    for (let hop = 0; hop < hops && frontier.size > 0; hop++) {
      const decay = 1 / (hop + 1); // 1.0 for hop 0, 0.5 for hop 1, etc.
      const nextFrontier = new Set<string>();

      // Batch query: fetch all relationships for entire frontier at once
      const frontierArray = [...frontier];
      const placeholders = frontierArray.map(() => '?').join(',');
      const params = [...frontierArray, ...frontierArray]; // for subject IN (...) OR object IN (...)

      const rels = this.db.prepare(`
        SELECT entry_id, subject, predicate, object, confidence
        FROM relationships
        WHERE LOWER(subject) IN (${placeholders})
           OR LOWER(object) IN (${placeholders})
      `).all(...params) as Array<{ entry_id: string; subject: string; predicate: string; object: string; confidence: number }>;

      for (const rel of rels) {
        const score = rel.confidence * decay;
        const existing = visited.get(rel.entry_id) ?? 0;
        if (score > existing) {
          visited.set(rel.entry_id, score);
        }

        // Add the other side of the relationship to the next frontier (with cycle detection)
        const subjectLower = rel.subject.toLowerCase();
        const objectLower = rel.object.toLowerCase();
        const other = frontier.has(subjectLower) ? objectLower : subjectLower;
        if (!visitedEntities.has(other)) {
          visitedEntities.add(other);
          nextFrontier.add(other);
        }
      }

      frontier = nextFrontier;
    }

    return visited;
  }

  // --- Database maintenance ---

  /**
   * Run database optimisation: PRAGMA optimize, FTS5 optimize, VACUUM.
   * Safe to call periodically (e.g., after bulk ingestion or daily).
   */
  optimize(): { optimized: boolean; message: string } {
    try {
      this.db.pragma('optimize');
      this.db.exec("INSERT INTO entries_fts(entries_fts) VALUES('optimize')");
      this.db.exec('VACUUM');
      return { optimized: true, message: 'Database optimised: PRAGMA optimize, FTS5 optimize, VACUUM' };
    } catch (err) {
      return { optimized: false, message: `Optimisation failed: ${err}` };
    }
  }

  /**
   * Get raw database instance for advanced operations.
   * Use with caution — direct access bypasses all abstractions.
   */
  get rawDb(): any { return this.db; }

  // --- File ingestion tracking (content-hash aware) ---

  /**
   * Find an ingested file by content hash (detects moved files).
   */
  findIngestedByHash(contentHash: string): { file_path: string; entry_id: string; mtime_ms: number } | null {
    const row = this.db.prepare(
      'SELECT file_path, entry_id, mtime_ms FROM ingested_files WHERE content_hash = ? LIMIT 1'
    ).get(contentHash) as any;
    return row ?? null;
  }

  /**
   * Update the tracked path for a moved file (same content hash, new path).
   */
  updateIngestedFilePath(oldPath: string, newPath: string): boolean {
    const result = this.db.prepare(
      "UPDATE ingested_files SET file_path = ?, updated_at = datetime('now') WHERE file_path = ?"
    ).run(newPath, oldPath);
    return result.changes > 0;
  }

  // --- Private helpers ---

  private logEvent(entryId: string | null, eventType: string, data: any): void {
    this.db.prepare(
      'INSERT INTO events (entry_id, event_type, data) VALUES (?, ?, ?)'
    ).run(entryId, eventType, JSON.stringify(data));
  }

  private rowToEntry(row: any): KnowledgeEntry {
    return {
      ...row,
      facts: JSON.parse(row.facts || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      keywords: JSON.parse(row.keywords || '[]'),
      relations: JSON.parse(row.relations || '[]'),
    };
  }

  /**
   * Write a Markdown file mirroring the entry.
   * Files are the human-readable source of truth.
   */
  private writeMarkdown(entry: KnowledgeEntry): void {
    const parts = [entry.domain];
    if (entry.topic) parts.push(entry.topic);
    if (entry.subtopic) parts.push(entry.subtopic);

    const dir = path.join(this.knowledgeDir, ...parts);
    fs.mkdirSync(dir, { recursive: true });

    const filename = entry.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      + '.md';

    const filepath = path.join(dir, filename);

    const frontmatter = [
      '---',
      `id: ${entry.id}`,
      `title: "${entry.title.replace(/"/g, '\\"')}"`,
      `domain: ${entry.domain}`,
      entry.topic ? `topic: ${entry.topic}` : null,
      entry.subtopic ? `subtopic: ${entry.subtopic}` : null,
      `importance: ${entry.importance}`,
      `confidence: ${entry.confidence}`,
      `tags: [${entry.tags.map(t => `"${t}"`).join(', ')}]`,
      `keywords: [${entry.keywords.map(k => `"${k}"`).join(', ')}]`,
      `source_type: ${entry.source_type}`,
      entry.source_ref ? `source_ref: "${entry.source_ref}"` : null,
      `status: ${entry.status}`,
      `version: ${entry.version}`,
      `created_at: ${entry.created_at}`,
      `updated_at: ${entry.updated_at}`,
      `freshness_at: ${entry.freshness_at}`,
      '---',
    ].filter(Boolean).join('\n');

    const factsSection = entry.facts.length > 0
      ? `\n## Facts\n\n${entry.facts.map(f => `- ${f}`).join('\n')}\n`
      : '';

    const summarySection = entry.summary
      ? `\n## Summary\n\n${entry.summary}\n`
      : '';

    const content = `${frontmatter}\n\n# ${entry.title}\n${summarySection}\n${entry.content}\n${factsSection}`;

    fs.writeFileSync(filepath, content, 'utf-8');
  }
}

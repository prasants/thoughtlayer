/**
 * ThoughtLayer Storage Schema
 *
 * SQLite tables for knowledge entries, embeddings, and events.
 * FTS5 virtual table for full-text search with BM25 ranking.
 */

export const SCHEMA_VERSION = 1;

export const CREATE_TABLES = `
  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_info (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Knowledge entries (primary records)
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT 'default',
    version INTEGER NOT NULL DEFAULT 1,

    -- Taxonomy
    domain TEXT NOT NULL,
    topic TEXT,
    subtopic TEXT,
    title TEXT NOT NULL,

    -- Content
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    summary TEXT,

    -- Structured data (JSON arrays)
    facts TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    keywords TEXT DEFAULT '[]',
    relations TEXT DEFAULT '[]',

    -- Provenance
    source_type TEXT DEFAULT 'conversation',
    source_ref TEXT,

    -- Lifecycle
    importance REAL NOT NULL DEFAULT 0.5,
    confidence REAL NOT NULL DEFAULT 0.8,
    freshness_at TEXT NOT NULL DEFAULT (datetime('now')),
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_entries_domain ON entries(domain);
  CREATE INDEX IF NOT EXISTS idx_entries_domain_topic ON entries(domain, topic);
  CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
  CREATE INDEX IF NOT EXISTS idx_entries_freshness ON entries(freshness_at);
  CREATE INDEX IF NOT EXISTS idx_entries_importance ON entries(importance DESC);
  CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id);
  CREATE INDEX IF NOT EXISTS idx_entries_content_hash ON entries(content_hash);

  -- FTS5 virtual table for full-text search (BM25 ranking built in)
  CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    title,
    content,
    tags,
    keywords,
    domain,
    topic,
    content='entries',
    content_rowid='rowid',
    tokenize='porter unicode61'
  );

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, title, content, tags, keywords, domain, topic)
    VALUES (new.rowid, new.title, new.content, new.tags, new.keywords, new.domain, new.topic);
  END;

  CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, title, content, tags, keywords, domain, topic)
    VALUES ('delete', old.rowid, old.title, old.content, old.tags, old.keywords, old.domain, old.topic);
  END;

  CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, title, content, tags, keywords, domain, topic)
    VALUES ('delete', old.rowid, old.title, old.content, old.tags, old.keywords, old.domain, old.topic);
    INSERT INTO entries_fts(rowid, title, content, tags, keywords, domain, topic)
    VALUES (new.rowid, new.title, new.content, new.tags, new.keywords, new.domain, new.topic);
  END;

  -- Embeddings table (vector search via sqlite-vss or manual cosine)
  CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    codec TEXT NOT NULL DEFAULT 'raw',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_embeddings_entry ON embeddings(entry_id);
  CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);

  -- Event log (append-only, for sync protocol)
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id TEXT,
    event_type TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_events_entry ON events(entry_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

  -- File ingestion tracker (dedup + change detection)
  CREATE TABLE IF NOT EXISTS ingested_files (
    file_path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    entry_id TEXT NOT NULL REFERENCES entries(id),
    file_size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ingested_hash ON ingested_files(content_hash);

  -- Knowledge graph relationships (entity triples)
  CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rel_entry ON relationships(entry_id);
  CREATE INDEX IF NOT EXISTS idx_rel_subject ON relationships(subject COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_rel_object ON relationships(object COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_rel_predicate ON relationships(predicate);

  -- Conflicts (for sync)
  CREATE TABLE IF NOT EXISTS conflicts (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    local_version INTEGER NOT NULL,
    remote_version INTEGER NOT NULL,
    local_content TEXT NOT NULL,
    remote_content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unresolved',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );
`;

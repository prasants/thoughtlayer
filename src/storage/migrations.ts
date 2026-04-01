/**
 * Schema Migration System
 *
 * Version-stamped migrations run in order on database open.
 * Each migration is a function that receives the raw better-sqlite3 Database instance.
 * Migrations are idempotent and run inside transactions.
 */

import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

/**
 * All migrations in version order.
 * New migrations MUST be appended at the end with incrementing version numbers.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    description: 'Add UNIQUE constraint on relationship triples and dedup existing rows',
    up: (db) => {
      // Remove duplicate relationship triples (keep the one with highest confidence)
      db.exec(`
        DELETE FROM relationships
        WHERE id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY entry_id, subject, predicate, object
              ORDER BY confidence DESC, created_at ASC
            ) as rn
            FROM relationships
          ) WHERE rn = 1
        )
      `);

      // Recreate relationships table with UNIQUE constraint
      // SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we need to recreate
      db.exec(`
        CREATE TABLE IF NOT EXISTS relationships_new (
          id TEXT PRIMARY KEY,
          entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.5,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(entry_id, subject, predicate, object)
        );

        INSERT OR IGNORE INTO relationships_new
          SELECT id, entry_id, subject, predicate, object, confidence, created_at
          FROM relationships;

        DROP TABLE relationships;
        ALTER TABLE relationships_new RENAME TO relationships;

        CREATE INDEX IF NOT EXISTS idx_rel_entry ON relationships(entry_id);
        CREATE INDEX IF NOT EXISTS idx_rel_subject ON relationships(subject COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_rel_object ON relationships(object COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_rel_predicate ON relationships(predicate);
      `);
    },
  },
  {
    version: 3,
    description: 'Add composite index for graph traversal on relationships(subject, object)',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_rel_subject_object
          ON relationships(subject COLLATE NOCASE, object COLLATE NOCASE);
      `);
    },
  },
  {
    version: 4,
    description: 'Add persistent embedding cache table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS embedding_cache (
          text_hash TEXT NOT NULL,
          model TEXT NOT NULL,
          embedding BLOB NOT NULL,
          codec TEXT NOT NULL DEFAULT 'raw',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (text_hash, model)
        );

        CREATE INDEX IF NOT EXISTS idx_embedding_cache_lru
          ON embedding_cache(last_used_at);
      `);
    },
  },
];

/**
 * Get the current schema version from the database.
 */
function getSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare("SELECT value FROM schema_info WHERE key = 'schema_version'").get() as any;
    if (row) return parseInt(row.value, 10);
  } catch {
    // schema_info may not exist yet or may not have schema_version key
  }

  // Fall back to the old 'version' key
  try {
    const row = db.prepare("SELECT value FROM schema_info WHERE key = 'version'").get() as any;
    if (row) return parseInt(row.value, 10);
  } catch {
    // No version info at all
  }

  return 1; // Default: assume version 1 (original schema)
}

/**
 * Set the schema version in the database.
 */
function setSchemaVersion(db: Database.Database, version: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('schema_version', ?)"
  ).run(String(version));
}

/**
 * Run all pending migrations.
 * Returns the number of migrations applied.
 */
export function runMigrations(db: Database.Database): number {
  const currentVersion = getSchemaVersion(db);
  const pending = MIGRATIONS.filter(m => m.version > currentVersion);

  if (pending.length === 0) return 0;

  let applied = 0;
  for (const migration of pending) {
    const runInTransaction = db.transaction(() => {
      migration.up(db);
      setSchemaVersion(db, migration.version);
    });

    try {
      runInTransaction();
      applied++;
    } catch (err) {
      throw new Error(
        `Migration v${migration.version} (${migration.description}) failed: ${err}`
      );
    }
  }

  return applied;
}

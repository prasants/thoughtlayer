/**
 * File Ingestion Engine
 *
 * Scans directories for markdown/text files, ingests them as knowledge entries,
 * tracks changes via content hash + mtime, and supports watch mode.
 *
 * Key design decisions:
 * - No LLM needed: files map directly to entries (title from filename/frontmatter,
 *   content from body, domain from directory structure).
 * - Dedup by content hash: same content in different paths won't duplicate.
 * - Change detection: re-ingests when file content changes.
 * - Deleted file handling: archives the entry when source file disappears.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { ThoughtLayer } from '../thoughtlayer.js';

export interface IngestOptions {
  /** Source directory to scan */
  sourceDir: string;
  /** File extensions to include (default: .md, .txt) */
  extensions?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Domain override (default: derived from directory structure) */
  domain?: string;
  /** Default importance for ingested entries */
  importance?: number;
  /** Whether to handle deleted files (archive entries) */
  handleDeleted?: boolean;
  /** Verbose logging callback */
  onLog?: (msg: string) => void;
}

export interface IngestResult {
  added: number;
  updated: number;
  unchanged: number;
  deleted: number;
  errors: Array<{ file: string; error: string }>;
}

interface ParsedFile {
  title: string;
  content: string;
  domain: string;
  topic?: string;
  tags: string[];
  keywords: string[];
  importance: number;
  summary?: string;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the frontmatter fields and the body content.
 */
function parseFrontmatter(raw: string): { frontmatter: Record<string, any>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const fm: Record<string, any> = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;

    // Handle arrays: [a, b, c]
    const arrayMatch = value.match(/^\[(.*)\]$/);
    if (arrayMatch) {
      fm[key] = arrayMatch[1]
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      fm[key] = value.replace(/^["']|["']$/g, '').trim();
    }
  }

  return { frontmatter: fm, body: match[2].trim() };
}

/**
 * Extract a clean title from a filename.
 */
function titleFromFilename(filename: string): string {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Parse a file into structured fields for ingestion.
 */
function parseFile(filePath: string, sourceDir: string, options: IngestOptions): ParsedFile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  const relPath = path.relative(sourceDir, filePath);
  const parts = relPath.split(path.sep);

  // Derive domain/topic from directory structure
  const defaultDomain = parts.length > 1 ? parts[0] : 'general';
  const defaultTopic = parts.length > 2 ? parts[1] : undefined;

  if (ext === '.md') {
    const { frontmatter: fm, body } = parseFrontmatter(raw);
    return {
      title: fm.title ?? titleFromFilename(filePath),
      content: body,
      domain: options.domain ?? fm.domain ?? defaultDomain,
      topic: fm.topic ?? defaultTopic,
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
      importance: parseFloat(fm.importance) || options.importance || 0.5,
      summary: fm.summary ?? fm.description,
    };
  }

  // Plain text / other
  return {
    title: titleFromFilename(filePath),
    content: raw.trim(),
    domain: options.domain ?? defaultDomain,
    topic: defaultTopic,
    tags: [],
    keywords: [],
    importance: options.importance ?? 0.5,
  };
}

/**
 * Recursively find files matching extensions.
 */
function findFiles(dir: string, extensions: string[], exclude: string[]): string[] {
  const results: string[] = [];

  const walk = (current: string) => {
    let items: string[];
    try {
      items = fs.readdirSync(current);
    } catch {
      return;
    }

    for (const item of items) {
      if (item.startsWith('.') || item.startsWith('_')) continue;

      const full = path.join(current, item);

      // Check excludes
      if (exclude.some(pat => full.includes(pat) || item === pat)) continue;

      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (item === 'node_modules' || item === '.git' || item === '.thoughtlayer') continue;
        walk(full);
      } else if (extensions.includes(path.extname(item).toLowerCase())) {
        results.push(full);
      }
    }
  };

  walk(dir);
  return results;
}

/**
 * Compute content hash for a file.
 */
function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Ingest files from a directory into ThoughtLayer.
 *
 * - New files: creates entries + embeddings
 * - Changed files: updates entries + re-embeds
 * - Deleted files: optionally archives entries
 * - Unchanged files: skipped
 */
export async function ingestFiles(
  thoughtlayer: ThoughtLayer,
  db: any, // ThoughtLayerDatabase: passed separately for tracking access
  options: IngestOptions
): Promise<IngestResult> {
  const extensions = options.extensions ?? ['.md', '.txt'];
  const exclude = options.exclude ?? [];
  const log = options.onLog ?? (() => {});

  const result: IngestResult = { added: 0, updated: 0, unchanged: 0, deleted: 0, errors: [] };

  const sourceDir = path.resolve(options.sourceDir);
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  // Find all eligible files
  const files = findFiles(sourceDir, extensions, exclude);
  log(`Found ${files.length} files in ${sourceDir}`);

  // Track which files we've seen (for delete detection)
  const seenPaths = new Set<string>();

  for (const filePath of files) {
    const relPath = path.relative(sourceDir, filePath);
    seenPaths.add(filePath);

    try {
      const stat = fs.statSync(filePath);
      const contentHash = hashFile(filePath);

      // Check if already ingested
      const existing = db.getIngestedFile(filePath);

      if (existing) {
        if (existing.content_hash === contentHash) {
          // Unchanged
          result.unchanged++;
          continue;
        }

        // Changed: update the entry
        const parsed = parseFile(filePath, sourceDir, options);

        if (!parsed.content || parsed.content.length < 10) {
          log(`  ⏭️  ${relPath} (too short, skipping update)`);
          result.unchanged++;
          continue;
        }

        await thoughtlayer.update(existing.entry_id, {
          title: parsed.title,
          content: parsed.content,
          domain: parsed.domain,
          topic: parsed.topic,
          tags: parsed.tags,
          keywords: parsed.keywords,
          importance: parsed.importance,
          summary: parsed.summary,
        });

        db.trackIngestedFile(filePath, contentHash, existing.entry_id, stat.size, stat.mtimeMs);
        log(`  🔄 ${relPath} (updated)`);
        result.updated++;
        continue;
      }

      // New file: parse and add
      const parsed = parseFile(filePath, sourceDir, options);

      if (!parsed.content || parsed.content.length < 10) {
        log(`  ⏭️  ${relPath} (too short, skipping)`);
        continue;
      }

      const entry = await thoughtlayer.add({
        domain: parsed.domain,
        topic: parsed.topic,
        title: parsed.title,
        content: parsed.content,
        summary: parsed.summary,
        tags: parsed.tags,
        keywords: parsed.keywords,
        importance: parsed.importance,
        source_type: 'file',
        source_ref: `file:${relPath}`,
      });

      db.trackIngestedFile(filePath, contentHash, entry.id, stat.size, stat.mtimeMs);
      log(`  ✅ ${relPath} → ${parsed.domain}${parsed.topic ? '/' + parsed.topic : ''}`);
      result.added++;
    } catch (err: any) {
      log(`  ❌ ${relPath}: ${err.message}`);
      result.errors.push({ file: relPath, error: err.message });
    }
  }

  // Handle deleted files
  if (options.handleDeleted !== false) {
    const tracked = db.listIngestedFiles();
    for (const tracked_file of tracked) {
      if (!seenPaths.has(tracked_file.file_path) && tracked_file.file_path.startsWith(sourceDir)) {
        // File was deleted
        thoughtlayer.archive(tracked_file.entry_id);
        db.untrackIngestedFile(tracked_file.file_path);
        log(`  🗑️  ${path.relative(sourceDir, tracked_file.file_path)} (archived)`);
        result.deleted++;
      }
    }
  }

  return result;
}

/**
 * Watch a directory for changes and re-ingest.
 * Uses fs.watch with debouncing.
 */
export function watchAndIngest(
  thoughtlayer: ThoughtLayer,
  db: any,
  options: IngestOptions & { debounceMs?: number }
): { close: () => void } {
  const debounceMs = options.debounceMs ?? 2000;
  const log = options.onLog ?? (() => {});
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watchers: fs.FSWatcher[] = [];

  const runIngest = async () => {
    try {
      const result = await ingestFiles(thoughtlayer, db, options);
      const changes = result.added + result.updated + result.deleted;
      if (changes > 0) {
        log(`\n📊 Sync: +${result.added} ~${result.updated} -${result.deleted} (${result.unchanged} unchanged)`);
      }
    } catch (err: any) {
      log(`❌ Ingest error: ${err.message}`);
    }
  };

  const scheduleIngest = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runIngest, debounceMs);
  };

  // Watch the source directory recursively
  const sourceDir = path.resolve(options.sourceDir);
  try {
    const watcher = fs.watch(sourceDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const ext = path.extname(filename).toLowerCase();
      const extensions = options.extensions ?? ['.md', '.txt'];
      if (!extensions.includes(ext)) return;
      if (filename.startsWith('.') || filename.includes('node_modules')) return;

      log(`  👀 ${eventType}: ${filename}`);
      scheduleIngest();
    });
    watchers.push(watcher);
  } catch (err: any) {
    log(`⚠️  Watch failed: ${err.message}. Falling back to polling.`);
    // Fallback: poll every 10s
    const interval = setInterval(scheduleIngest, 10000);
    return {
      close: () => {
        clearInterval(interval);
        if (timer) clearTimeout(timer);
      },
    };
  }

  // Initial ingest
  runIngest();

  return {
    close: () => {
      for (const w of watchers) w.close();
      if (timer) clearTimeout(timer);
    },
  };
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayerDatabase } from '../src/storage/database.js';
import { cosineSimilarity } from '../src/retrieve/vector.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Edge Cases', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtlayer-edge-'));
    db = new ThoughtLayerDatabase(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Storage edge cases ---

  it('handles empty content', () => {
    const entry = db.create({
      domain: 'test',
      title: 'Empty Content',
      content: '',
    });
    expect(entry.id).toBeDefined();
    expect(entry.content).toBe('');
  });

  it('handles very long content', () => {
    const longContent = 'x'.repeat(100_000);
    const entry = db.create({
      domain: 'test',
      title: 'Long Content',
      content: longContent,
    });

    const retrieved = db.getById(entry.id);
    expect(retrieved!.content.length).toBe(100_000);
  });

  it('handles unicode content', () => {
    const entry = db.create({
      domain: 'i18n',
      title: '日本語テスト',
      content: 'Ümlauts, ñ, 中文, العربية, emoji: 🧠💡🔍',
      tags: ['unicode', '日本語'],
    });

    const retrieved = db.getById(entry.id);
    expect(retrieved!.title).toBe('日本語テスト');
    expect(retrieved!.content).toContain('🧠');
    expect(retrieved!.tags).toContain('日本語');
  });

  it('handles special characters in title (file-safe markdown)', () => {
    const entry = db.create({
      domain: 'test',
      title: 'What is "foo/bar" & <baz>?',
      content: 'Content with special chars',
    });

    // Should create a markdown file without crashing
    const knowledgeDir = path.join(tmpDir, '.thoughtlayer', 'knowledge', 'test');
    const files = fs.readdirSync(knowledgeDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it('handles duplicate titles in same domain', () => {
    const e1 = db.create({ domain: 'test', title: 'Same Title', content: 'First' });
    const e2 = db.create({ domain: 'test', title: 'Same Title', content: 'Second' });

    // Both should exist with different IDs
    expect(e1.id).not.toBe(e2.id);

    const list = db.list({ domain: 'test' });
    expect(list.length).toBe(2);
  });

  it('getById returns null for non-existent ID', () => {
    const result = db.getById('non-existent-id');
    expect(result).toBeNull();
  });

  it('update returns null for non-existent ID', () => {
    const result = db.update('non-existent-id', { content: 'new' });
    expect(result).toBeNull();
  });

  it('archive returns false for non-existent ID', () => {
    const result = db.archive('non-existent-id');
    expect(result).toBe(false);
  });

  it('handles entries with no tags or keywords', () => {
    const entry = db.create({
      domain: 'minimal',
      title: 'Bare Minimum',
      content: 'Just content, nothing else.',
    });

    expect(entry.tags).toEqual([]);
    expect(entry.keywords).toEqual([]);

    const retrieved = db.getById(entry.id);
    expect(retrieved!.tags).toEqual([]);
  });

  it('FTS handles empty query gracefully', () => {
    db.create({ domain: 'test', title: 'Entry', content: 'Some content' });

    const results = db.searchFTS('');
    expect(results).toEqual([]);
  });

  it('FTS handles query with only special characters', () => {
    db.create({ domain: 'test', title: 'Entry', content: 'Some content' });

    const results = db.searchFTS('!@#$%^&*()');
    expect(results).toEqual([]);
  });

  it('list with offset for pagination', () => {
    for (let i = 0; i < 10; i++) {
      db.create({ domain: 'test', title: `Entry ${i}`, content: `Content ${i}`, importance: i / 10 });
    }

    const page1 = db.list({ limit: 3, offset: 0 });
    const page2 = db.list({ limit: 3, offset: 3 });

    expect(page1.length).toBe(3);
    expect(page2.length).toBe(3);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it('list filters by tags', () => {
    db.create({ domain: 'test', title: 'Tagged', content: 'c', tags: ['important', 'urgent'] });
    db.create({ domain: 'test', title: 'Untagged', content: 'c', tags: [] });
    db.create({ domain: 'test', title: 'Other Tag', content: 'c', tags: ['low-priority'] });

    const results = db.list({ tags: ['important'] });
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Tagged');
  });

  it('health on empty database', () => {
    const health = db.health();
    expect(health.total).toBe(0);
    expect(health.active).toBe(0);
    expect(health.archived).toBe(0);
    expect(health.avgImportance).toBe(0);
    expect(Object.keys(health.domains)).toHaveLength(0);
  });

  // --- Vector edge cases ---

  it('cosine similarity of zero vector returns 0', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('cosine similarity throws on dimension mismatch', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(() => cosineSimilarity(a, b)).toThrow(/dimension mismatch/);
  });

  it('stores multiple embeddings for same entry', () => {
    const entry = db.create({ domain: 'test', title: 'Multi Embed', content: 'c' });

    const emb1 = new Float32Array([0.1, 0.2, 0.3]);
    const emb2 = new Float32Array([0.4, 0.5, 0.6]);

    db.storeEmbedding(entry.id, emb1, 'model-v1');
    db.storeEmbedding(entry.id, emb2, 'model-v2');

    // Should retrieve an embedding (implementation returns one of them)
    const retrieved = db.getEmbedding(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.embedding.length).toBe(3);
  });

  it('getEmbedding returns null for entry without embedding', () => {
    const entry = db.create({ domain: 'test', title: 'No Embed', content: 'c' });
    const result = db.getEmbedding(entry.id);
    expect(result).toBeNull();
  });

  // --- Content hash ---

  it('content hash changes when content changes', () => {
    const e1 = db.create({ domain: 'test', title: 'Hash Test', content: 'version 1' });
    const e2 = db.update(e1.id, { content: 'version 2' });

    expect(e1.content_hash).not.toBe(e2!.content_hash);
  });

  it('identical content produces identical hash', () => {
    const e1 = db.create({ domain: 'test', title: 'A', content: 'same content' });
    const e2 = db.create({ domain: 'test', title: 'B', content: 'same content' });

    expect(e1.content_hash).toBe(e2.content_hash);
  });
});

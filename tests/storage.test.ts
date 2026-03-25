import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayerDatabase } from '../src/storage/database.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ThoughtLayerDatabase', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtlayer-test-'));
    db = new ThoughtLayerDatabase(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and retrieves an entry', () => {
    const entry = db.create({
      domain: 'authentication',
      topic: 'jwt',
      title: 'JWT Refresh Token Strategy',
      content: 'Refresh tokens expire after 7 days. Use rotating refresh tokens for security.',
      tags: ['security', 'auth'],
      keywords: ['jwt', 'refresh', 'token', 'expiry'],
      importance: 0.8,
    });

    expect(entry.id).toBeDefined();
    expect(entry.domain).toBe('authentication');
    expect(entry.title).toBe('JWT Refresh Token Strategy');
    expect(entry.tags).toEqual(['security', 'auth']);

    const retrieved = db.getById(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('JWT Refresh Token Strategy');
  });

  it('writes Markdown files', () => {
    db.create({
      domain: 'deployment',
      title: 'CI CD Pipeline',
      content: 'Uses GitHub Actions with staging and production environments.',
      tags: ['devops'],
      keywords: ['ci', 'cd', 'github-actions'],
    });

    const mdPath = path.join(tmpDir, '.thoughtlayer', 'knowledge', 'deployment', 'ci_cd_pipeline.md');
    expect(fs.existsSync(mdPath)).toBe(true);

    const content = fs.readFileSync(mdPath, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('CI CD Pipeline');
    expect(content).toContain('GitHub Actions');
  });

  it('FTS search returns results ranked by BM25', () => {
    db.create({
      domain: 'auth',
      title: 'OAuth2 Google SSO',
      content: 'Google SSO integration using OAuth2 PKCE flow. Handles token refresh automatically.',
      keywords: ['oauth', 'google', 'sso'],
    });

    db.create({
      domain: 'database',
      title: 'PostgreSQL Indexing',
      content: 'B-tree indexes for equality, GIN for arrays, GiST for geometric.',
      keywords: ['postgres', 'indexing'],
    });

    const results = db.searchFTS('oauth google');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('OAuth2 Google SSO');
  });

  it('lists entries with filters', () => {
    db.create({ domain: 'auth', title: 'Entry A', content: 'Content A', importance: 0.9 });
    db.create({ domain: 'auth', title: 'Entry B', content: 'Content B', importance: 0.3 });
    db.create({ domain: 'database', title: 'Entry C', content: 'Content C', importance: 0.7 });

    const authEntries = db.list({ domain: 'auth' });
    expect(authEntries.length).toBe(2);

    const important = db.list({ minImportance: 0.5 });
    expect(important.length).toBe(2);
  });

  it('updates entries and increments version', () => {
    const entry = db.create({
      domain: 'auth',
      title: 'Token Expiry',
      content: 'Tokens expire after 24 hours.',
    });

    const updated = db.update(entry.id, {
      content: 'Tokens expire after 7 days (changed from 24 hours).',
    });

    expect(updated).not.toBeNull();
    expect(updated!.version).toBe(2);
    expect(updated!.content).toContain('7 days');
  });

  it('archives entries (soft delete)', () => {
    const entry = db.create({ domain: 'test', title: 'To Archive', content: 'Will be archived' });

    const result = db.archive(entry.id);
    expect(result).toBe(true);

    const archived = db.getById(entry.id);
    expect(archived!.status).toBe('archived');

    // Should not appear in default list
    const listed = db.list();
    expect(listed.find(e => e.id === entry.id)).toBeUndefined();
  });

  it('stores and retrieves embeddings', () => {
    const entry = db.create({ domain: 'test', title: 'Embed Test', content: 'Test content' });

    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    db.storeEmbedding(entry.id, embedding, 'test-model');

    const retrieved = db.getEmbedding(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.model).toBe('test-model');
    expect(retrieved!.embedding.length).toBe(5);
    expect(Math.abs(retrieved!.embedding[0] - 0.1)).toBeLessThan(0.001);
  });

  it('reports health metrics', () => {
    db.create({ domain: 'auth', title: 'A', content: 'a' });
    db.create({ domain: 'auth', title: 'B', content: 'b' });
    db.create({ domain: 'db', title: 'C', content: 'c' });

    const health = db.health();
    expect(health.total).toBe(3);
    expect(health.active).toBe(3);
    expect(health.domains['auth']).toBe(2);
    expect(health.domains['db']).toBe(1);
  });

  it('records access and tracks counts', () => {
    const entry = db.create({ domain: 'test', title: 'Access Test', content: 'Test' });
    expect(entry.access_count).toBe(0);

    db.recordAccess(entry.id);
    db.recordAccess(entry.id);

    const updated = db.getById(entry.id);
    expect(updated!.access_count).toBe(2);
    expect(updated!.last_accessed_at).not.toBeNull();
  });
});

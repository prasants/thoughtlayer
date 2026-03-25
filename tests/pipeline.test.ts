import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayerDatabase } from '../src/storage/database.js';
import { retrieve } from '../src/retrieve/pipeline.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Retrieval Pipeline', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtlayer-pipeline-'));
    db = new ThoughtLayerDatabase(tmpDir);

    // Seed test data
    db.create({
      domain: 'architecture',
      topic: 'database',
      title: 'Database Choice',
      content: 'Using PostgreSQL with pgvector for embeddings. Chosen for JSON support and mature ecosystem.',
      tags: ['database', 'architecture'],
      keywords: ['postgres', 'postgresql', 'pgvector', 'database'],
      importance: 0.9,
    });

    db.create({
      domain: 'architecture',
      topic: 'api',
      title: 'API Framework',
      content: 'REST API built with Express.js. GraphQL considered but rejected for complexity.',
      tags: ['api', 'architecture'],
      keywords: ['express', 'rest', 'api', 'graphql'],
      importance: 0.7,
    });

    db.create({
      domain: 'team',
      title: 'Engineering Lead',
      content: 'Priya Mehta is VP Engineering. Joined in 2024. Responsible for platform and infrastructure.',
      tags: ['people', 'leadership'],
      keywords: ['sarah', 'chen', 'vp', 'engineering'],
      importance: 0.6,
    });

    db.create({
      domain: 'operations',
      title: 'Deployment Process',
      content: 'CI/CD via GitHub Actions. Staging auto-deploys on merge to main. Production requires approval.',
      tags: ['devops', 'deployment'],
      keywords: ['ci', 'cd', 'github-actions', 'deploy'],
      importance: 0.8,
    });

    db.create({
      domain: 'decisions',
      title: 'Authentication Strategy',
      content: 'JWT with rotating refresh tokens. Access tokens expire in 15 minutes. Refresh tokens in 7 days.',
      tags: ['security', 'auth'],
      keywords: ['jwt', 'auth', 'token', 'refresh'],
      importance: 0.85,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retrieves results using keyword search only (no embeddings)', () => {
    const results = retrieve(db, {
      query: 'postgresql database',
      topK: 3,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.title).toBe('Database Choice');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].sources.freshness).toBeGreaterThan(0);
  });

  it('filters by domain', () => {
    const results = retrieve(db, {
      query: 'architecture',
      domain: 'architecture',
      topK: 10,
    });

    for (const r of results) {
      expect(r.entry.domain).toBe('architecture');
    }
  });

  it('respects topK limit', () => {
    const results = retrieve(db, {
      query: 'engineering deployment database',
      topK: 2,
    });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array when nothing matches', () => {
    const results = retrieve(db, {
      query: 'xyzzy quantum blockchain metaverse',
      topK: 5,
    });

    expect(results).toEqual([]);
  });

  it('includes score breakdown in sources', () => {
    const results = retrieve(db, {
      query: 'jwt authentication tokens',
      topK: 1,
    });

    expect(results.length).toBe(1);
    expect(results[0].sources.fts).toBeDefined();
    expect(results[0].sources.freshness).toBeGreaterThan(0);
    expect(results[0].sources.freshness).toBeLessThanOrEqual(1);
    expect(results[0].sources.importance).toBeGreaterThan(0);
  });

  it('importance weighting affects ranking', () => {
    // Create two entries matching the same query, different importance
    db.create({
      domain: 'test',
      title: 'Low Priority Note',
      content: 'Redis is used for caching session data.',
      keywords: ['redis', 'cache', 'session'],
      importance: 0.1,
    });

    db.create({
      domain: 'test',
      title: 'Critical Decision',
      content: 'Redis cluster with sentinel for cache failover.',
      keywords: ['redis', 'cache', 'cluster'],
      importance: 1.0,
    });

    const results = retrieve(db, {
      query: 'redis cache',
      topK: 2,
      domain: 'test',
    });

    expect(results.length).toBe(2);
    expect(results[0].entry.title).toBe('Critical Decision');
  });

  it('custom weights override defaults', () => {
    const results = retrieve(db, {
      query: 'database',
      topK: 5,
      weights: {
        vector: 0,
        fts: 0.9,
        freshness: 0,
        importance: 0.1,
      },
    });

    // Should still return results with keyword-heavy weighting
    expect(results.length).toBeGreaterThan(0);
  });

  it('handles special characters in query gracefully', () => {
    const queries = [
      'what is the database?',
      'auth: JWT + OAuth',
      'deploy (staging)',
      'C++ & Rust',
      '',
    ];

    for (const q of queries) {
      expect(() => retrieve(db, { query: q, topK: 3 })).not.toThrow();
    }
  });

  it('does not return archived entries', () => {
    const entry = db.create({
      domain: 'test',
      title: 'Archived Entry',
      content: 'This should not appear in results after archiving.',
      keywords: ['archived', 'hidden'],
      importance: 1.0,
    });

    db.archive(entry.id);

    const results = retrieve(db, {
      query: 'archived hidden',
      topK: 5,
    });

    const found = results.find(r => r.entry.id === entry.id);
    expect(found).toBeUndefined();
  });
});

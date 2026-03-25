import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayerDatabase } from '../src/storage/database.js';
import { resolveEntities, levenshtein, extractAliases } from '../src/retrieve/entity.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Entity Resolution', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtlayer-entity-'));
    db = new ThoughtLayerDatabase(tmpDir);

    db.create({
      domain: 'team',
      title: 'Priya Mehta \u2014 VP Engineering',
      content: 'Priya Mehta is VP Engineering. Joined in 2024. Responsible for platform and infrastructure.',
      tags: ['people', 'leadership', 'alias:PM'],
      keywords: ['sarah', 'chen', 'vp', 'engineering'],
      importance: 0.8,
    });

    db.create({
      domain: 'team',
      title: 'John Smith \u2014 Backend Engineer',
      content: 'John Smith is a senior backend engineer. Expert in PostgreSQL and Rust.',
      tags: ['people', 'engineering', 'alias:JW'],
      keywords: ['john', 'smith', 'backend', 'engineer', 'js'],
      importance: 0.6,
    });

    db.create({
      domain: 'architecture',
      title: 'Database Choice',
      content: 'Using PostgreSQL with pgvector for embeddings.',
      tags: ['database', 'architecture'],
      keywords: ['postgres', 'pgvector'],
      importance: 0.9,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('matches full name exactly', () => {
    const entries = db.list({ limit: 100 });
    const matches = resolveEntities('What does Priya Mehta work on?', entries);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].matchType).toBe('exact');
    expect(matches[0].confidence).toBe(1.0);
  });

  it('matches first name only', () => {
    const entries = db.list({ limit: 100 });
    const matches = resolveEntities('What did John mention about the API?', entries);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some(m => m.matchType === "first_name")).toBe(true);
  });

  it('matches aliases', () => {
    const entries = db.list({ limit: 100 });
    // PM should match Priya Mehta
    const matches = resolveEntities('Ask PM about the deployment', entries);
    expect(matches.some(m => m.matchType === 'alias')).toBe(true);
  });

  it('does not match non-people entries on name patterns', () => {
    const entries = db.list({ limit: 100 });
    const matches = resolveEntities('Tell me about PostgreSQL', entries);
    // Should not match "Database Choice" via entity resolution
    const dbMatch = matches.find(m => {
      const entry = entries.find(e => e.id === m.entryId);
      return entry?.title === 'Database Choice';
    });
    expect(dbMatch).toBeUndefined();
  });

  it('handles fuzzy name matching for typos', () => {
    const entries = db.list({ limit: 100 });
    // "Prya" is 1 edit away from "Priya"
    const matches = resolveEntities('Ask Prya about it', entries);
    expect(matches.some(m => m.matchType === 'fuzzy')).toBe(true);
  });

  it('calculates Levenshtein distance correctly', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('sarah', 'sarh')).toBe(1);
    expect(levenshtein('john', 'jon')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('extracts aliases from tags', () => {
    const entries = db.list({ limit: 100 });
    const sarahEntry = entries.find(e => e.title.includes('Priya'))!;
    const aliases = extractAliases(sarahEntry);
    expect(aliases).toContain('pm');
  });
});

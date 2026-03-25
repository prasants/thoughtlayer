/**
 * Knowledge Graph Module Tests
 *
 * Tests relationship extraction, storage, graph traversal, and retrieval integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractRelationships, type Relationship } from '../src/ingest/relationships.js';
import { graphBoost, extractQueryEntities } from '../src/retrieve/graph.js';
import { ThoughtLayerDatabase } from '../src/storage/database.js';
import { retrieve } from '../src/retrieve/pipeline.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Relationship Extraction Tests ──

describe('extractRelationships', () => {
  it('extracts "X is the Y of Z" pattern', () => {
    const rels = extractRelationships('Alice is the CEO of Acme Corp.', 'Leadership');
    expect(rels.some(r => r.subject === 'Alice' && r.predicate === 'ceo' && r.object === 'Acme Corp')).toBe(true);
  });

  it('extracts "X works at Z" pattern', () => {
    const rels = extractRelationships('Bob works at Google.', 'Staff');
    expect(rels.some(r => r.subject === 'Bob' && r.predicate === 'works_at' && r.object === 'Google')).toBe(true);
  });

  it('extracts "X works for Z" pattern', () => {
    const rels = extractRelationships('Carol works for Microsoft.', 'Staff');
    expect(rels.some(r => r.subject === 'Carol' && r.predicate === 'works_at' && r.object === 'Microsoft')).toBe(true);
  });

  it('extracts "X reports to Y" pattern', () => {
    const rels = extractRelationships('Dave reports to Emily.', 'Org');
    expect(rels.some(r => r.subject === 'Dave' && r.predicate === 'reports_to' && r.object === 'Emily')).toBe(true);
  });

  it('extracts "X decided Y" pattern', () => {
    const rels = extractRelationships('Frank decided to use PostgreSQL.', 'Decisions');
    expect(rels.some(r => r.subject === 'Frank' && r.predicate === 'decided')).toBe(true);
  });

  it('extracts "X uses Y" pattern', () => {
    const rels = extractRelationships('Acme uses Redis for caching.', 'Tech Stack');
    expect(rels.some(r => r.subject === 'Acme' && r.predicate === 'uses' && r.object === 'Redis')).toBe(true);
  });

  it('extracts "X manages Y" pattern', () => {
    const rels = extractRelationships('Grace manages Engineering.', 'Teams');
    expect(rels.some(r => r.subject === 'Grace' && r.predicate === 'manages' && r.object === 'Engineering')).toBe(true);
  });

  it('extracts "X owns Y" pattern', () => {
    const rels = extractRelationships('Helen owns the billing module.', 'Ownership');
    expect(rels.some(r => r.subject === 'Helen' && r.predicate === 'owns' && r.object === 'billing module')).toBe(true);
  });

  it('extracts "X depends on Y" pattern', () => {
    const rels = extractRelationships('Auth depends on Redis.', 'Dependencies');
    expect(rels.some(r => r.predicate === 'depends_on' && r.object === 'Redis')).toBe(true);
  });

  it('extracts "X leads Y" pattern', () => {
    const rels = extractRelationships('Ivan leads Platform.', 'Teams');
    expect(rels.some(r => r.subject === 'Ivan' && r.predicate === 'leads' && r.object === 'Platform')).toBe(true);
  });

  it('extracts "X joined Y" pattern', () => {
    const rels = extractRelationships('Jane joined Apple last month.', 'Moves');
    expect(rels.some(r => r.subject === 'Jane' && r.predicate === 'joined' && r.object === 'Apple')).toBe(true);
  });

  it('extracts "X acquired Y" pattern', () => {
    const rels = extractRelationships('Google acquired DeepMind in 2014.', 'M&A');
    expect(rels.some(r => r.subject === 'Google' && r.predicate === 'acquired' && r.object === 'DeepMind')).toBe(true);
  });

  it('extracts multiple relationships from one text', () => {
    const text = 'Alice works at Acme. Bob reports to Alice. Acme uses Kubernetes.';
    const rels = extractRelationships(text, 'Company');
    expect(rels.length).toBeGreaterThanOrEqual(3);
  });

  it('deduplicates identical relationships', () => {
    const text = 'Alice works at Acme. Alice works at Acme.';
    const rels = extractRelationships(text, 'Staff');
    const worksAt = rels.filter(r => r.subject === 'Alice' && r.predicate === 'works_at');
    expect(worksAt.length).toBe(1);
  });

  it('returns empty array for content with no recognisable patterns', () => {
    const rels = extractRelationships('the quick brown fox jumps over the lazy dog.', 'Animals');
    // Should be empty or very few (no capitalised proper nouns in patterns)
    expect(rels.length).toBe(0);
  });

  it('extracts title-based relationships for meeting titles', () => {
    const rels = extractRelationships('Discussed budget and roadmap.', 'Meeting with Alex');
    expect(rels.some(r => r.subject === 'Alex' && r.predicate === 'mentioned_in')).toBe(true);
  });
});

// ── Query Entity Extraction Tests ──

describe('extractQueryEntities', () => {
  it('extracts capitalised names from queries', () => {
    const entities = extractQueryEntities('What does Alice do?');
    expect(entities).toContain('Alice');
  });

  it('extracts multi-word proper nouns', () => {
    const entities = extractQueryEntities('Tell me about Acme Corp');
    expect(entities.some(e => e.includes('Acme'))).toBe(true);
  });

  it('returns empty for queries with no entities', () => {
    const entities = extractQueryEntities('what is the weather today');
    expect(entities.length).toBe(0);
  });
});

// ── Storage and Retrieval Tests ──

describe('graph storage and traversal', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-graph-test-'));
    db = new ThoughtLayerDatabase(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves relationships for an entry', () => {
    const entry = db.create({
      domain: 'test',
      title: 'Team Structure',
      content: 'Alice works at Acme.',
    });

    db.storeRelationship(entry.id, 'Alice', 'works_at', 'Acme', 0.85);

    const rels = db.getRelationships(entry.id);
    expect(rels.length).toBe(1);
    expect(rels[0].subject).toBe('Alice');
    expect(rels[0].predicate).toBe('works_at');
    expect(rels[0].object).toBe('Acme');
    expect(rels[0].confidence).toBe(0.85);
  });

  it('findRelated returns entries connected to an entity', () => {
    const entry = db.create({
      domain: 'test',
      title: 'People',
      content: 'Alice works at Acme.',
    });

    db.storeRelationship(entry.id, 'Alice', 'works_at', 'Acme', 0.85);

    const related = db.findRelated('Alice');
    expect(related.length).toBe(1);
    expect(related[0].entry_id).toBe(entry.id);
  });

  it('traverseGraph returns entries within 1 hop', () => {
    const e1 = db.create({ domain: 'test', title: 'Entry 1', content: 'Alice at Acme' });
    db.storeRelationship(e1.id, 'Alice', 'works_at', 'Acme', 0.9);

    const result = db.traverseGraph('Alice', 1);
    expect(result.has(e1.id)).toBe(true);
    expect(result.get(e1.id)).toBeGreaterThan(0);
  });

  it('traverseGraph finds entries within 2 hops', () => {
    const e1 = db.create({ domain: 'test', title: 'Entry 1', content: 'Alice at Acme' });
    const e2 = db.create({ domain: 'test', title: 'Entry 2', content: 'Acme uses Redis' });

    db.storeRelationship(e1.id, 'Alice', 'works_at', 'Acme', 0.9);
    db.storeRelationship(e2.id, 'Acme', 'uses', 'Redis', 0.8);

    // Starting from Alice, hop 1 reaches e1 (via Acme), hop 2 should reach e2 (via Acme)
    const result = db.traverseGraph('Alice', 2);
    expect(result.has(e1.id)).toBe(true);
    expect(result.has(e2.id)).toBe(true);
    // 2-hop entry should have lower score (decay)
    expect(result.get(e1.id)!).toBeGreaterThanOrEqual(result.get(e2.id)!);
  });

  it('traverseGraph returns empty map for unknown entity', () => {
    const result = db.traverseGraph('NonExistent', 2);
    expect(result.size).toBe(0);
  });
});

// ── Graph Boost Tests ──

describe('graphBoost', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-graphboost-test-'));
    db = new ThoughtLayerDatabase(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty map when no entities in query', () => {
    const boost = graphBoost('what is the weather', db);
    expect(boost.size).toBe(0);
  });

  it('returns empty map when no relationships in database', () => {
    db.create({ domain: 'test', title: 'Something', content: 'No relationships here.' });
    const boost = graphBoost('Tell me about Alice', db);
    expect(boost.size).toBe(0);
  });

  it('returns boost scores for entries connected to query entities', () => {
    const entry = db.create({ domain: 'test', title: 'Staff', content: 'Alice at Acme.' });
    db.storeRelationship(entry.id, 'Alice', 'works_at', 'Acme', 0.9);

    const boost = graphBoost('What does Alice do?', db);
    expect(boost.has(entry.id)).toBe(true);
    expect(boost.get(entry.id)!).toBeGreaterThan(0);
  });
});

// ── Pipeline Integration Tests ──

describe('pipeline with graph boost', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-pipeline-graph-test-'));
    db = new ThoughtLayerDatabase(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retrieval works identically when no relationships exist', () => {
    db.create({ domain: 'test', title: 'Redis Guide', content: 'Redis is a fast in-memory database.' });
    db.create({ domain: 'test', title: 'PostgreSQL Guide', content: 'PostgreSQL is a relational database.' });

    const results = retrieve(db, { query: 'database', topK: 5 });
    // Should return results based on FTS/term matching alone
    expect(results.length).toBeGreaterThan(0);
    // Graph boost should be 0 for all results
    for (const r of results) {
      expect(r.sources.graphBoost).toBe(0);
    }
  });

  it('graph-connected entries get boosted in retrieval', () => {
    const e1 = db.create({
      domain: 'people',
      title: 'Alice Profile',
      content: 'Alice is a senior engineer who specialises in distributed systems.',
    });
    db.create({
      domain: 'people',
      title: 'Bob Profile',
      content: 'Bob is a junior analyst who focuses on reporting.',
    });

    db.storeRelationship(e1.id, 'Alice', 'works_at', 'Acme', 0.9);

    const results = retrieve(db, { query: 'Who is Alice?', topK: 5 });
    // Alice's entry should appear and have a graph boost
    const aliceResult = results.find(r => r.entry.id === e1.id);
    expect(aliceResult).toBeDefined();
    if (aliceResult) {
      expect(aliceResult.sources.graphBoost).toBeGreaterThan(0);
    }
  });
});

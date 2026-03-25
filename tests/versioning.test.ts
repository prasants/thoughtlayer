import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayerDatabase } from '../src/storage/database.js';
import { checkContradiction, addWithVersioning, listConflicts, getConflictInfo } from '../src/retrieve/versioning.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Fact Versioning & Contradiction Detection', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtlayer-version-'));
    db = new ThoughtLayerDatabase(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects contradiction when same topic has different facts', () => {
    db.create({
      domain: 'architecture',
      topic: 'database',
      title: 'Database Choice',
      content: 'We are using PostgreSQL for the main database.',
      facts: ['PostgreSQL is the main database'],
      importance: 0.9,
    });

    const check = checkContradiction(db, {
      domain: 'architecture',
      topic: 'database',
      title: 'Database Choice',
      content: 'We are migrating to CockroachDB for the main database.',
      facts: ['CockroachDB is the main database'],
    });

    expect(check.hasContradiction).toBe(true);
    expect(check.existingEntry).not.toBeNull();
  });

  it('does not flag contradiction for unrelated entries', () => {
    db.create({
      domain: 'architecture',
      topic: 'database',
      title: 'Database Choice',
      content: 'Using PostgreSQL for data.',
      facts: ['PostgreSQL is used'],
      importance: 0.9,
    });

    const check = checkContradiction(db, {
      domain: 'architecture',
      topic: 'api',
      title: 'API Framework',
      content: 'Using Express.js for the API layer.',
      facts: ['Express.js is the API framework'],
    });

    expect(check.hasContradiction).toBe(false);
  });

  it('creates supersedes relation when adding contradicting entry', () => {
    db.create({
      domain: 'decisions',
      topic: 'auth',
      title: 'Auth Strategy Decision',
      content: 'We decided to use JWT tokens for authentication.',
      facts: ['JWT tokens for auth'],
      importance: 0.8,
    });

    const result = addWithVersioning(db, {
      domain: 'decisions',
      topic: 'auth',
      title: 'Auth Strategy Decision',
      content: 'We switched to session-based auth with httpOnly cookies.',
      facts: ['Session-based auth with cookies'],
    });

    expect(result.isContradiction).toBe(true);
    expect(result.superseded).not.toBeNull();
    expect(result.entry.relations.some(r => r.type === 'supersedes')).toBe(true);
    expect(result.entry.tags).toContain('has_prior_version');
  });

  it('lists all conflicts', () => {
    db.create({
      domain: 'operations',
      topic: 'deploy',
      title: 'Deploy Cadence',
      content: 'We deploy every Tuesday.',
      facts: ['Deploy every Tuesday'],
      importance: 0.7,
    });

    addWithVersioning(db, {
      domain: 'operations',
      topic: 'deploy',
      title: 'Deploy Cadence',
      content: 'We now deploy daily with CI/CD.',
      facts: ['Daily deploys via CI/CD'],
    });

    const conflicts = listConflicts(db);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].current.content).toContain('daily');
    expect(conflicts[0].previous.content).toContain('Tuesday');
  });

  it('getConflictInfo returns superseded entries', () => {
    const original = db.create({
      domain: 'team',
      topic: 'roles',
      title: 'CTO Role',
      content: 'Alex is the CTO.',
      facts: ['Alex is CTO'],
      importance: 0.8,
    });

    const result = addWithVersioning(db, {
      domain: 'team',
      topic: 'roles',
      title: 'CTO Role',
      content: 'Maria is now the CTO, replacing Alex.',
      facts: ['Maria is CTO'],
    });

    const info = getConflictInfo(db, result.entry);
    expect(info.hasConflicts).toBe(true);
    expect(info.supersededEntries).toHaveLength(1);
    expect(info.supersededEntries[0].id).toBe(original.id);
  });

  it('handles entries without facts gracefully', () => {
    db.create({
      domain: 'notes',
      title: 'Meeting Notes',
      content: 'Discussed roadmap and priorities for Q2.',
      importance: 0.5,
    });

    const check = checkContradiction(db, {
      domain: 'notes',
      title: 'Different Meeting Notes',
      content: 'Sprint planning for next week.',
    });

    expect(check.hasContradiction).toBe(false);
  });
});

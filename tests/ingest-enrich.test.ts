import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayer } from '../src/thoughtlayer.js';
import { ingestFiles } from '../src/ingest/files.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Ingest with enrichment', () => {
  let tmpDir: string;
  let sourceDir: string;
  let tl: ThoughtLayer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-ingest-enrich-'));
    sourceDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(sourceDir, { recursive: true });
    tl = ThoughtLayer.init(tmpDir);
  });

  afterEach(() => {
    tl.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enriches keywords when ingesting markdown files', async () => {
    // Create a test markdown file with concepts that should trigger enrichment
    const mdContent = `---
title: "Database Migration Plan"
tags: ["infrastructure"]
---

# Database Migration Plan

We need to deploy the new database server. The team will migrate all user data
to the upgraded system. Sarah is a senior engineer responsible for the migration.
`;
    fs.writeFileSync(path.join(sourceDir, 'migration.md'), mdContent);

    const result = await ingestFiles(tl, tl.database, {
      sourceDir,
      extensions: ['.md'],
    });

    expect(result.added).toBe(1);

    // Check that the entry has enriched keywords (synonyms)
    const entries = tl.list();
    expect(entries).toHaveLength(1);
    const entry = entries[0];

    // Should have synonym-based enrichment
    // "deploy" -> release/ship/launch, "database" -> db/datastore/storage, etc.
    expect(entry.keywords.length).toBeGreaterThan(0);
    const allKeywords = entry.keywords.map(k => k.toLowerCase());
    const hasSynonyms = allKeywords.some(k =>
      ['release', 'ship', 'launch', 'db', 'datastore', 'storage',
       'backend', 'service', 'host', 'move', 'transfer', 'port'].includes(k)
    );
    expect(hasSynonyms).toBe(true);
  });

  it('ingested files are searchable by enriched terms', async () => {
    const mdContent = `---
title: "Bug Fix Report"
---

# Bug Fix Report

We fixed the authentication error that was causing login failures.
The issue was in the database connection pool configuration.
`;
    fs.writeFileSync(path.join(sourceDir, 'bugfix.md'), mdContent);

    await ingestFiles(tl, tl.database, {
      sourceDir,
      extensions: ['.md'],
    });

    // Should be findable by synonym terms
    const results = await tl.search('defect');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.title).toBe('Bug Fix Report');
  });
});

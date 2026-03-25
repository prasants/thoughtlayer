import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ThoughtLayer } from '../src/thoughtlayer.js';
import { ingestFiles } from '../src/ingest/files.js';

describe('File Ingestion', () => {
  let tmpDir: string;
  let tl: ThoughtLayer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-test-'));
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    tl = ThoughtLayer.init(tmpDir, {});
  });

  afterEach(() => {
    tl.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ingests markdown files with frontmatter', async () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'test.md'), `---
title: Test Entry
tags: [foo, bar]
importance: 0.9
---

# Test Entry

This is a test knowledge entry with enough content to pass the minimum threshold.
`);

    const result = await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });
    expect(result.added).toBe(1);
    expect(result.unchanged).toBe(0);

    const entries = tl.list();
    expect(entries.length).toBe(1);
    expect(entries[0].title).toBe('Test Entry');
    expect(entries[0].tags).toEqual(['foo', 'bar']);
    expect(entries[0].importance).toBe(0.9);
  });

  it('deduplicates on re-ingest', async () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'test.md'), 'This is enough content for a test entry, with some more words to pass the threshold.\n');

    const r1 = await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });
    expect(r1.added).toBe(1);

    const r2 = await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });
    expect(r2.added).toBe(0);
    expect(r2.unchanged).toBe(1);
  });

  it('detects changed files', async () => {
    const filePath = path.join(tmpDir, 'docs', 'test.md');
    fs.writeFileSync(filePath, 'Original content that is long enough to be ingested as a knowledge entry.\n');

    await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });

    fs.writeFileSync(filePath, 'Updated content that has been changed and is still long enough for ingestion.\n');

    const r2 = await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });
    expect(r2.updated).toBe(1);
    expect(r2.added).toBe(0);
  });

  it('archives entries for deleted files', async () => {
    const filePath = path.join(tmpDir, 'docs', 'test.md');
    fs.writeFileSync(filePath, 'Content that will be deleted but is long enough for ingestion test purposes.\n');

    await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });
    expect(tl.list().length).toBe(1);

    fs.unlinkSync(filePath);

    const r2 = await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });
    expect(r2.deleted).toBe(1);

    // Entry still exists but is archived
    const all = tl.list({ status: 'archived' });
    expect(all.length).toBe(1);
  });

  it('derives domain from directory structure', async () => {
    fs.mkdirSync(path.join(tmpDir, 'docs', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'api', 'endpoints.md'),
      'API endpoints documentation with enough content to pass the minimum character threshold.\n'
    );

    await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });

    const entries = tl.list();
    expect(entries[0].domain).toBe('api');
  });

  it('skips files that are too short', async () => {
    fs.writeFileSync(path.join(tmpDir, 'docs', 'tiny.md'), 'Hi\n');

    const result = await ingestFiles(tl, tl.database, { sourceDir: path.join(tmpDir, 'docs') });
    expect(result.added).toBe(0);
  });
});

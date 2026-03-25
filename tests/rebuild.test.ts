import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayer } from '../src/thoughtlayer.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Rebuild', () => {
  let tmpDir: string;
  let tl: ThoughtLayer;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-rebuild-'));
    tl = ThoughtLayer.init(tmpDir);

    // Add some entries
    await tl.add({
      domain: 'test',
      title: 'Database Migration',
      content: 'We need to deploy the new database to production.',
    });
    await tl.add({
      domain: 'test',
      title: 'Bug Fix',
      content: 'Fixed the authentication error in the login flow.',
    });
  });

  afterEach(() => {
    tl.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rebuilds all entries with fresh enrichment', async () => {
    const result = await tl.rebuild();
    expect(result.total).toBe(2);
    expect(result.enriched).toBe(2);
    expect(result.embedded).toBe(0); // No embedder configured
  });

  it('calls progress callback', async () => {
    const progress: Array<{ current: number; total: number }> = [];
    await tl.rebuild({
      onProgress: (current, total) => {
        progress.push({ current, total });
      },
    });
    expect(progress).toHaveLength(2);
    expect(progress[0].current).toBe(1);
    expect(progress[1].current).toBe(2);
  });

  it('updates keywords on entries after rebuild', async () => {
    await tl.rebuild();
    const entries = tl.list();
    // Both entries should have enriched keywords
    for (const entry of entries) {
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });
});

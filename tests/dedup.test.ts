import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayerDatabase } from '../src/storage/database.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Content-hash dedup', () => {
  let db: ThoughtLayerDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-dedup-'));
    db = new ThoughtLayerDatabase(tmpDir);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns existing entry when content_hash and title match', () => {
    const input = {
      domain: 'test',
      title: 'Duplicate Test',
      content: 'This is some content that should not be duplicated.',
    };

    const first = db.create(input);
    const second = db.create(input);

    expect(second.id).toBe(first.id);
    expect(db.count()).toBe(1);
  });

  it('allows different titles with same content', () => {
    const first = db.create({
      domain: 'test',
      title: 'Title A',
      content: 'Same content here.',
    });
    const second = db.create({
      domain: 'test',
      title: 'Title B',
      content: 'Same content here.',
    });

    expect(second.id).not.toBe(first.id);
    expect(db.count()).toBe(2);
  });

  it('allows same title with different content', () => {
    const first = db.create({
      domain: 'test',
      title: 'Same Title',
      content: 'Content version 1.',
    });
    const second = db.create({
      domain: 'test',
      title: 'Same Title',
      content: 'Content version 2.',
    });

    expect(second.id).not.toBe(first.id);
    expect(db.count()).toBe(2);
  });

  it('does not return archived entries as duplicates', () => {
    const first = db.create({
      domain: 'test',
      title: 'Archived Entry',
      content: 'This entry will be archived.',
    });
    db.archive(first.id);

    const second = db.create({
      domain: 'test',
      title: 'Archived Entry',
      content: 'This entry will be archived.',
    });

    expect(second.id).not.toBe(first.id);
  });
});

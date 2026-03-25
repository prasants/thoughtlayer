import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayer } from '../src/thoughtlayer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ThoughtLayer (high-level API)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtlayer-api-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init creates .thoughtlayer directory and config', () => {
    const tl = ThoughtLayer.init(tmpDir);

    const configPath = path.join(tmpDir, '.thoughtlayer', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.version).toBe(1);

    tl.close();
  });

  it('load throws if not initialised', () => {
    expect(() => ThoughtLayer.load(tmpDir)).toThrow(/No ThoughtLayer project found/);
  });

  it('init then load round-trips', () => {
    const tl1 = ThoughtLayer.init(tmpDir);
    tl1.close();

    const tl2 = ThoughtLayer.load(tmpDir);
    expect(tl2.count()).toBe(0);
    tl2.close();
  });

  it('add creates an entry retrievable by search', async () => {
    const tl = ThoughtLayer.init(tmpDir);

    // add() without embeddings should still work (keyword search)
    const addPromise = tl.add({
      domain: 'test',
      title: 'API Rate Limits',
      content: 'Rate limit is 100 requests per minute per API key. Burst up to 20.',
      tags: ['api', 'limits'],
      keywords: ['rate', 'limit', 'api'],
      importance: 0.7,
    });

    const entry = await addPromise;
    expect(entry.id).toBeDefined();
    expect(entry.title).toBe('API Rate Limits');
    expect(entry.domain).toBe('test');

    // Keyword search should find it (now uses full pipeline)
    const results = await tl.search('rate limit');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.title).toBe('API Rate Limits');

    tl.close();
  });

  it('list filters by domain', async () => {
    const tl = ThoughtLayer.init(tmpDir);

    await tl.add({ domain: 'auth', title: 'SSO Setup', content: 'Google SSO via OAuth2' });
    await tl.add({ domain: 'auth', title: 'API Keys', content: 'API key rotation policy' });
    await tl.add({ domain: 'infra', title: 'AWS Setup', content: 'Running on us-east-1' });

    const authEntries = tl.list({ domain: 'auth' });
    expect(authEntries.length).toBe(2);

    const infraEntries = tl.list({ domain: 'infra' });
    expect(infraEntries.length).toBe(1);

    tl.close();
  });

  it('update modifies content and bumps version', async () => {
    const tl = ThoughtLayer.init(tmpDir);

    const entry = await tl.add({
      domain: 'config',
      title: 'Timeout Setting',
      content: 'Request timeout is 30 seconds.',
    });

    const updated = await tl.update(entry.id, {
      content: 'Request timeout changed to 60 seconds.',
    });

    expect(updated).not.toBeNull();
    expect(updated!.version).toBe(2);
    expect(updated!.content).toContain('60 seconds');

    tl.close();
  });

  it('archive removes entry from default list', async () => {
    const tl = ThoughtLayer.init(tmpDir);

    const entry = await tl.add({
      domain: 'temp',
      title: 'Temporary Note',
      content: 'This will be archived.',
    });

    tl.archive(entry.id);

    const list = tl.list();
    expect(list.find(e => e.id === entry.id)).toBeUndefined();

    // But get() still finds it
    const found = tl.get(entry.id);
    expect(found).not.toBeNull();
    expect(found!.status).toBe('archived');

    tl.close();
  });

  it('health returns accurate stats', async () => {
    const tl = ThoughtLayer.init(tmpDir);

    await tl.add({ domain: 'a', title: 'A1', content: 'content', importance: 0.8 });
    await tl.add({ domain: 'a', title: 'A2', content: 'content', importance: 0.6 });
    await tl.add({ domain: 'b', title: 'B1', content: 'content', importance: 0.4 });

    const health = tl.health();
    expect(health.total).toBe(3);
    expect(health.active).toBe(3);
    expect(health.archived).toBe(0);
    expect(health.domains['a']).toBe(2);
    expect(health.domains['b']).toBe(1);
    expect(health.avgImportance).toBeCloseTo(0.6, 1);

    tl.close();
  });

  it('count returns correct number', async () => {
    const tl = ThoughtLayer.init(tmpDir);

    expect(tl.count()).toBe(0);

    await tl.add({ domain: 'x', title: 'X', content: 'x' });
    await tl.add({ domain: 'y', title: 'Y', content: 'y' });

    expect(tl.count()).toBe(2);

    tl.close();
  });

  it('config file does not contain API keys', () => {
    const tl = ThoughtLayer.init(tmpDir, {
      projectRoot: tmpDir,
      embedding: { provider: 'openai', apiKey: 'sk-secret-key-123' },
    });

    const configPath = path.join(tmpDir, '.thoughtlayer', 'config.json');
    const configContent = fs.readFileSync(configPath, 'utf-8');

    expect(configContent).not.toContain('sk-secret-key-123');
    expect(configContent).toContain('"provider"');

    tl.close();
  });
});

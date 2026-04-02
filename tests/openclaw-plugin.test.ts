import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayer } from '../src/thoughtlayer.js';
import { createOpenClawPlugin } from '../src/integrations/openclaw-plugin.js';
import type { OpenClawPluginAPI } from '../src/integrations/openclaw-plugin.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tl: ThoughtLayer;
let tmpDir: string;
let memoryDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-openclaw-'));
  memoryDir = path.join(tmpDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  tl = ThoughtLayer.init(tmpDir);
  tl.close(); // Close so the plugin can load it fresh
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Create a mock OpenClaw plugin API that captures registered tools.
 */
function createMockAPI(configOverride?: any): {
  api: OpenClawPluginAPI;
  tools: Map<string, any>;
} {
  const tools = new Map<string, any>();

  const api: OpenClawPluginAPI = {
    config: configOverride ?? {
      plugins: {
        entries: {
          thoughtlayer: {
            config: {
              projectDir: tmpDir,
              ingestOnQuery: false, // Disable for speed in tests
              ingestPaths: [memoryDir],
            },
          },
        },
      },
    },
    registerTool(definition: any, _options?: any) {
      tools.set(definition.name, definition);
    },
  };

  return { api, tools };
}

describe('OpenClaw Plugin', () => {
  describe('createOpenClawPlugin', () => {
    it('returns a function', () => {
      const plugin = createOpenClawPlugin(tmpDir);
      expect(typeof plugin).toBe('function');
    });

    it('registers five tools', () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();

      plugin(api);

      expect(tools.size).toBe(5);
      expect(tools.has('thoughtlayer_query')).toBe(true);
      expect(tools.has('thoughtlayer_add')).toBe(true);
      expect(tools.has('thoughtlayer_ingest')).toBe(true);
      expect(tools.has('thoughtlayer_health')).toBe(true);
      expect(tools.has('thoughtlayer_preflight')).toBe(true);
    });

    it('each tool has name, description, parameters, and execute', () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();

      plugin(api);

      for (const [name, tool] of tools) {
        expect(tool.name).toBe(name);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(10);
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe('function');
      }
    });
  });

  describe('thoughtlayer_add', () => {
    it('adds an entry and returns confirmation', async () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();
      plugin(api);

      const addTool = tools.get('thoughtlayer_add');
      const result = await addTool.execute('test', {
        content: 'The team decided to use Postgres for the v2 rewrite.',
        domain: 'decisions',
        title: 'Database Choice',
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Database Choice');
      expect(result.content[0].text).toContain('decisions');
    });

    it('uses default domain and title when not provided', async () => {
      const plugin = createOpenClawPlugin(tmpDir, {
        defaultDomain: 'notes',
      });
      const { api, tools } = createMockAPI();
      plugin(api);

      const addTool = tools.get('thoughtlayer_add');
      const result = await addTool.execute('test', {
        content: 'A short note about something important.',
      });

      expect(result.content[0].text).toContain('notes');
    });
  });

  describe('thoughtlayer_query', () => {
    it('returns results for matching content', async () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();
      plugin(api);

      // Add an entry first
      const addTool = tools.get('thoughtlayer_add');
      await addTool.execute('test', {
        content: 'Sarah Chen is the CEO of Acme Corp.',
        domain: 'people',
        title: 'Acme CEO',
      });

      // Query for it
      const queryTool = tools.get('thoughtlayer_query');
      const result = await queryTool.execute('test', {
        query: 'who is the CEO',
        topK: 3,
      });

      expect(result.content[0].text).toContain('Acme CEO');
    });

    it('returns no results message when nothing matches', async () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();
      plugin(api);

      const queryTool = tools.get('thoughtlayer_query');
      const result = await queryTool.execute('test', {
        query: 'completely random nonexistent topic xyz123',
      });

      expect(result.content[0].text).toContain('No results');
    });
  });

  describe('thoughtlayer_health', () => {
    it('returns health metrics', async () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();
      plugin(api);

      // Add an entry so there's something to report
      const addTool = tools.get('thoughtlayer_add');
      await addTool.execute('test', {
        content: 'Test entry for health check.',
        domain: 'test',
      });

      const healthTool = tools.get('thoughtlayer_health');
      const result = await healthTool.execute('test', {});

      expect(result.content[0].text).toContain('ThoughtLayer Health');
      expect(result.content[0].text).toContain('Total:');
      expect(result.content[0].text).toContain('Active:');
    });
  });

  describe('thoughtlayer_ingest', () => {
    it('ingests markdown files from a directory', async () => {
      // Write a test file
      fs.writeFileSync(
        path.join(memoryDir, 'test-note.md'),
        '# Test Note\n\nThis is a test note for ingest verification.'
      );

      const plugin = createOpenClawPlugin(tmpDir, {
        ingestPaths: [memoryDir],
      });
      const { api, tools } = createMockAPI();
      plugin(api);

      const ingestTool = tools.get('thoughtlayer_ingest');
      const result = await ingestTool.execute('test', {});

      expect(result.content[0].text).toContain('Ingest complete');
      expect(result.content[0].text).toContain('added: 1');
    });

    it('accepts a custom path', async () => {
      const customDir = path.join(tmpDir, 'custom');
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(
        path.join(customDir, 'custom-note.md'),
        '# Custom\n\nCustom content.'
      );

      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();
      plugin(api);

      const ingestTool = tools.get('thoughtlayer_ingest');
      const result = await ingestTool.execute('test', {
        path: customDir,
      });

      expect(result.content[0].text).toContain('Ingest complete');
      expect(result.content[0].text).toContain('added: 1');
    });
  });

  describe('config override from OpenClaw', () => {
    it('reads projectDir from OpenClaw config', () => {
      const plugin = createOpenClawPlugin('/fallback/path');
      const { api, tools } = createMockAPI({
        plugins: {
          entries: {
            thoughtlayer: {
              config: {
                projectDir: tmpDir,
                ingestOnQuery: false,
              },
            },
          },
        },
      });

      plugin(api);

      // Tool should be registered (would fail if projectDir was wrong)
      expect(tools.size).toBe(5);
    });
  });

  describe('round-trip: add then query', () => {
    it('entry added via add is retrievable via query', async () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();
      plugin(api);

      // Add
      await tools.get('thoughtlayer_add').execute('test', {
        content: 'ThoughtLayer v0.4.0 ships with native OpenClaw plugin support.',
        domain: 'projects',
        title: 'ThoughtLayer v0.4.0 Release',
      });

      // Query
      const result = await tools.get('thoughtlayer_query').execute('test', {
        query: 'ThoughtLayer OpenClaw plugin',
        topK: 1,
      });

      expect(result.content[0].text).toContain('v0.4.0');
    });
  });

  describe('thoughtlayer_preflight', () => {
    it('returns corrections when domain matches', async () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();
      plugin(api);

      // Add a correction
      await tools.get('thoughtlayer_add').execute('test', {
        content: 'Always try alternative approaches before saying something is unavailable',
        domain: 'corrections',
        importance: '1.0',
        title: 'BEFORE SAYING CANT: Exhaust alternatives first',
      });

      // Preflight should surface it
      const result = await tools.get('thoughtlayer_preflight').execute('test', {
        message: 'I cannot access that file',
      });

      expect(result.content[0].text).toContain('CORRECTIONS');
      expect(result.content[0].text).toContain('BEFORE SAYING CANT');
    });

    it('returns no corrections message on empty database', async () => {
      const plugin = createOpenClawPlugin(tmpDir);
      const { api, tools } = createMockAPI();
      plugin(api);

      const result = await tools.get('thoughtlayer_preflight').execute('test', {
        message: 'something completely unrelated to anything stored',
      });

      expect(result.content[0].text).toContain('No relevant corrections');
    });
  });

  describe('round-trip: ingest then query', () => {
    it('ingested file is queryable', async () => {
      fs.writeFileSync(
        path.join(memoryDir, 'decision-log.md'),
        '# Architecture Decision\n\nWe chose SQLite with FTS5 for local-first search. No external dependencies needed.'
      );

      const plugin = createOpenClawPlugin(tmpDir, {
        ingestPaths: [memoryDir],
      });
      const { api, tools } = createMockAPI();
      plugin(api);

      // Ingest
      await tools.get('thoughtlayer_ingest').execute('test', {});

      // Query
      const result = await tools.get('thoughtlayer_query').execute('test', {
        query: 'what database for search',
        topK: 1,
      });

      expect(result.content[0].text).toContain('SQLite');
    });
  });
});

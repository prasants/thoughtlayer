/**
 * OpenClaw Plugin Integration
 *
 * Native ThoughtLayer plugin for OpenClaw agent frameworks.
 * Registers five tools: query, add, ingest, health, preflight.
 * Uses ThoughtLayer's library API directly: no CLI, no exec, no shell.
 *
 * @example
 * ```typescript
 * // In ~/.openclaw/extensions/thoughtlayer/index.ts
 * import { createOpenClawPlugin } from 'thoughtlayer';
 * export default createOpenClawPlugin('/path/to/workspace');
 * ```
 *
 * @example
 * ```typescript
 * // With options
 * import { createOpenClawPlugin } from 'thoughtlayer';
 * export default createOpenClawPlugin('/path/to/workspace', {
 *   ingestOnQuery: true,
 *   ingestPaths: ['./memory/', './'],
 * });
 * ```
 */

import { ThoughtLayer } from '../thoughtlayer.js';
import { ingestFiles, type IngestResult } from '../ingest/files.js';
import { getContext } from './openclaw.js';
import type { RetrievalResult } from '../retrieve/pipeline.js';

export interface OpenClawPluginOptions {
  /** Run ingest before every query to ensure fresh results. Default: true */
  ingestOnQuery?: boolean;
  /** Paths to ingest when ingestOnQuery is true. Default: ['<projectDir>/memory/', '<projectDir>/'] */
  ingestPaths?: string[];
  /** Default domain for new entries. Default: 'general' */
  defaultDomain?: string;
  /** Default importance for new entries. Default: 0.7 */
  defaultImportance?: number;
}

/**
 * Create an OpenClaw plugin registration function.
 *
 * Returns a function that accepts the OpenClaw plugin API and registers
 * five tools: thoughtlayer_query, thoughtlayer_add, thoughtlayer_ingest,
 * and thoughtlayer_health.
 */
export function createOpenClawPlugin(
  projectDir: string,
  options?: OpenClawPluginOptions
): (api: OpenClawPluginAPI) => void {
  const opts: Required<OpenClawPluginOptions> = {
    ingestOnQuery: options?.ingestOnQuery ?? true,
    ingestPaths: options?.ingestPaths ?? [
      projectDir + '/memory/',
      projectDir + '/',
    ],
    defaultDomain: options?.defaultDomain ?? 'general',
    defaultImportance: options?.defaultImportance ?? 0.7,
  };

  return function register(api: OpenClawPluginAPI): void {
    // Read config from OpenClaw plugin entries if available
    const pluginConfig = api.config?.plugins?.entries?.thoughtlayer?.config;
    const dir = pluginConfig?.projectDir ?? projectDir;
    const doIngestOnQuery = pluginConfig?.ingestOnQuery ?? opts.ingestOnQuery;
    const ingestPathsList: string[] = pluginConfig?.ingestPaths ?? opts.ingestPaths;

    // Lazy-loaded singleton ThoughtLayer instance
    let _tl: ThoughtLayer | null = null;
    let _loadPromise: Promise<ThoughtLayer> | null = null;

    async function getTL(): Promise<ThoughtLayer> {
      if (_tl) return _tl;
      if (_loadPromise) return _loadPromise;

      _loadPromise = (async () => {
        try {
          _tl = await ThoughtLayer.loadWithAutoDetect(dir);
        } catch {
          _tl = ThoughtLayer.load(dir);
        }
        return _tl;
      })();

      return _loadPromise;
    }

    async function runIngest(paths: string[]): Promise<IngestResult[]> {
      const tl = await getTL();
      const results: IngestResult[] = [];

      for (const p of paths) {
        try {
          const result = await ingestFiles(tl, tl.database, {
            sourceDir: p,
            handleDeleted: false,
          });
          results.push(result);
        } catch {
          // Non-fatal: path might not exist or be inaccessible
        }
      }

      return results;
    }

    function formatResults(results: RetrievalResult[]): string {
      if (!results || results.length === 0) {
        return 'No results found.';
      }

      const lines: string[] = [`Found ${results.length} results:\n`];

      for (const r of results) {
        const e = r.entry;
        const signals = [
          r.sources.vector ? 'vec ✓' : null,
          r.sources.fts ? 'fts ✓' : null,
          r.sources.entityBoost ? 'entity ✓' : null,
          r.sources.temporalBoost ? 'temporal ✓' : null,
        ]
          .filter(Boolean)
          .join('] [');

        lines.push(`  📄 ${e.title}`);
        lines.push(`     Domain: ${e.domain}`);
        lines.push(
          `     Score: ${r.score.toFixed(4)}${signals ? ` [${signals}]` : ''}`
        );

        const preview = e.content.substring(0, 200).replace(/\n/g, ' ');
        lines.push(
          `     ${preview}${e.content.length > 200 ? '...' : ''}\n`
        );
      }

      return lines.join('\n');
    }

    // ─── thoughtlayer_query ─────────────────────────────────────────
    api.registerTool({
      name: 'thoughtlayer_query',
      description:
        'Search workspace memory using ThoughtLayer (semantic + keyword + temporal). ' +
        'Use this for recalling facts about people, projects, decisions, meetings, ' +
        'health protocols, or any institutional knowledge. ' +
        'Returns top results ranked by relevance.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          topK: {
            type: 'number',
            description: 'Number of results to return (default 5)',
            minimum: 1,
            maximum: 20,
          },
        },
        required: ['query'],
      },
      async execute(_id: string, params: { query: string; topK?: number }) {
        const topK = params.topK || 5;

        if (doIngestOnQuery) {
          await runIngest(ingestPathsList);
        }

        const tl = await getTL();
        const results = await tl.query(params.query, { topK });

        return {
          content: [{ type: 'text' as const, text: formatResults(results) }],
        };
      },
    });

    // ─── thoughtlayer_ingest ────────────────────────────────────────
    api.registerTool({
      name: 'thoughtlayer_ingest',
      description:
        'Sync workspace files into ThoughtLayer memory index. ' +
        'Run after writing important files to ensure they are searchable.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path to ingest (default: workspace memory/ and root)',
          },
        },
        required: [],
      },
      async execute(_id: string, params: { path?: string }) {
        const paths = params.path ? [params.path] : ingestPathsList;
        const results = await runIngest(paths);

        const tl = await getTL();
        const health = tl.health();

        const summary = results
          .map(
            (r) =>
              `added: ${r.added}, updated: ${r.updated}, unchanged: ${r.unchanged}`
          )
          .join('; ');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Ingest complete. ${summary}\n\nHealth: ${health.total} entries (${health.active} active, ${health.archived} archived, ${health.stale} stale). Domains: ${JSON.stringify(health.domains)}`,
            },
          ],
        };
      },
    });

    // ─── thoughtlayer_health ────────────────────────────────────────
    api.registerTool({
      name: 'thoughtlayer_health',
      description: 'Show ThoughtLayer knowledge base health metrics',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute() {
        const tl = await getTL();
        const h = tl.health();
        return {
          content: [
            {
              type: 'text' as const,
              text: `ThoughtLayer Health:\n- Total: ${h.total} entries\n- Active: ${h.active}\n- Archived: ${h.archived}\n- Stale: ${h.stale}\n- Avg importance: ${h.avgImportance.toFixed(1)}\n- Domains: ${JSON.stringify(h.domains, null, 2)}`,
            },
          ],
        };
      },
    });

    // ─── thoughtlayer_add ───────────────────────────────────────────
    api.registerTool({
      name: 'thoughtlayer_add',
      description:
        'Add a knowledge entry to ThoughtLayer. Use for capturing important ' +
        'facts, decisions, or context that should persist across sessions.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Knowledge content to store',
          },
          domain: {
            type: 'string',
            description:
              'Domain category (e.g. engineering, health, people, projects)',
          },
          title: { type: 'string', description: 'Entry title' },
        },
        required: ['content'],
      },
      async execute(
        _id: string,
        params: { content: string; domain?: string; title?: string }
      ) {
        const tl = await getTL();
        const entry = await tl.add({
          content: params.content,
          domain: params.domain || opts.defaultDomain,
          title:
            params.title ||
            params.content.substring(0, 60).replace(/\n/g, ' '),
          importance: opts.defaultImportance,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Entry added: "${entry.title}" (id: ${entry.id}, domain: ${entry.domain})`,
            },
          ],
        };
      },
    });

    // ─── thoughtlayer_preflight ───────────────────────────────────────
    api.registerTool({
      name: 'thoughtlayer_preflight',
      description:
        'MANDATORY PRE-RESPONSE CHECK. Call this BEFORE responding to any user message. ' +
        'Pass the user\'s message and this tool checks ThoughtLayer for known corrections, ' +
        'past mistakes, gotchas, and relevant context. Returns critical information that ' +
        'MUST be considered before you respond. Skipping this tool has caused repeated ' +
        'failures and user frustration. When in doubt, call this tool.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: "The user's message to check against known corrections and context",
          },
        },
        required: ['message'],
      },
      async execute(
        _id: string,
        params: { message: string }
      ) {
        if (doIngestOnQuery) {
          await runIngest(ingestPathsList);
        }

        const tl = await getTL();
        const results = await tl.query(params.message, { topK: 10 });

        const corrections: RetrievalResult[] = [];
        const context: RetrievalResult[] = [];

        for (const r of results) {
          if (r.entry.domain === 'corrections' || r.entry.importance >= 0.9) {
            corrections.push(r);
          } else if (r.score >= 0.3) {
            context.push(r);
          }
        }

        const lines: string[] = [];

        if (corrections.length > 0) {
          lines.push('\u26a0\ufe0f  CORRECTIONS & GOTCHAS (read these before responding):\n');
          for (const r of corrections) {
            lines.push(`  \ud83d\udd34 ${r.entry.title}`);
            const body = r.entry.content.substring(0, 300).replace(/\n/g, ' ');
            lines.push(`     ${body}${r.entry.content.length > 300 ? '...' : ''}\n`);
          }
        }

        if (context.length > 0) {
          lines.push('\ud83d\udccb RELEVANT CONTEXT:\n');
          for (const r of context.slice(0, 5)) {
            lines.push(`  \ud83d\udcc4 ${r.entry.title} (${r.entry.domain})`);
            const preview = r.entry.content.substring(0, 150).replace(/\n/g, ' ');
            lines.push(`     ${preview}${r.entry.content.length > 150 ? '...' : ''}\n`);
          }
        }

        if (lines.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No relevant corrections or context found. Proceed normally.' }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      },
    });
  };
}

/**
 * Minimal type for the OpenClaw plugin API.
 * Only the methods we actually use are typed here.
 */
export interface OpenClawPluginAPI {
  config?: {
    plugins?: {
      entries?: {
        thoughtlayer?: {
          config?: {
            projectDir?: string;
            ingestOnQuery?: boolean;
            ingestPaths?: string[];
          };
        };
      };
    };
  };
  registerTool(
    definition: {
      name: string;
      description: string;
      parameters: unknown;
      execute: (id: string, params: any) => Promise<{
        content: Array<{ type: 'text'; text: string }>;
      }>;
    },
    options?: { optional?: boolean }
  ): void;
}

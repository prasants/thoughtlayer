#!/usr/bin/env node

/**
 * ThoughtLayer MCP Server
 *
 * Model Context Protocol server that exposes ThoughtLayer's knowledge base
 * to any MCP client (Claude Desktop, Cursor, etc.).
 *
 * Tools:
 *   - thoughtlayer_query: Semantic + keyword search
 *   - thoughtlayer_add: Add a knowledge entry
 *   - thoughtlayer_curate: LLM-powered knowledge extraction
 *   - thoughtlayer_search: Keyword-only search
 *   - thoughtlayer_list: List entries with filters
 *   - thoughtlayer_health: Knowledge health metrics
 *   - thoughtlayer_update: Fact versioning with contradiction tracking
 *   - thoughtlayer_search_temporal: Time-aware search
 *   - thoughtlayer_list_conflicts: Review contradictions
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ThoughtLayer } from '../thoughtlayer.js';
import { addWithVersioning, listConflicts } from '../retrieve/versioning.js';
import { parseTemporalRefs, temporalBoost } from '../retrieve/temporal.js';

let thoughtlayer: ThoughtLayer;

function getThoughtLayer(): ThoughtLayer {
  if (!thoughtlayer) {
    const projectRoot = process.env.THOUGHTLAYER_PROJECT_ROOT || process.cwd();
    thoughtlayer = ThoughtLayer.load(projectRoot);
  }
  return thoughtlayer;
}

const server = new Server(
  {
    name: 'thoughtlayer',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// === TOOLS ===

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'thoughtlayer_query',
      description:
        'Search the knowledge base using semantic (vector) + keyword search with freshness decay. Returns the most relevant entries for a natural language query.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Natural language query',
          },
          top_k: {
            type: 'number',
            description: 'Maximum results to return (default: 5)',
          },
          domain: {
            type: 'string',
            description: 'Filter by domain (e.g., "health", "projects", "people")',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'thoughtlayer_add',
      description:
        'Add a knowledge entry manually. Use for storing decisions, facts, rules, or any structured knowledge.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: {
            type: 'string',
            description: 'Human-readable title',
          },
          content: {
            type: 'string',
            description: 'Knowledge content (Markdown)',
          },
          domain: {
            type: 'string',
            description: 'Top-level category (e.g., "architecture", "decisions", "people")',
          },
          topic: {
            type: 'string',
            description: 'Sub-category within domain',
          },
          importance: {
            type: 'number',
            description: 'Importance score 0.0-1.0 (default: 0.5)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorisation',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords for search',
          },
        },
        required: ['title', 'content', 'domain'],
      },
    },
    {
      name: 'thoughtlayer_curate',
      description:
        'Extract structured knowledge from raw text using an LLM. The LLM identifies facts, decisions, and context, then stores them as knowledge entries.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: {
            type: 'string',
            description: 'Raw text to extract knowledge from',
          },
          domain: {
            type: 'string',
            description: 'Force all extracted entries into this domain',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'thoughtlayer_search',
      description:
        'Keyword-only search (FTS5/BM25). No embeddings needed. Fast and deterministic.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search terms',
          },
          limit: {
            type: 'number',
            description: 'Maximum results (default: 5)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'thoughtlayer_list',
      description: 'List knowledge entries with optional filters.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            description: 'Filter by domain',
          },
          limit: {
            type: 'number',
            description: 'Maximum entries (default: 20)',
          },
        },
        required: [],
      },
    },
    {
      name: 'thoughtlayer_update',
      description:
        'Update an existing fact with versioning. Creates a new version that supersedes the old one, preserving contradiction history.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          topic: {
            type: 'string',
            description: 'Topic of the fact to update',
          },
          title: {
            type: 'string',
            description: 'Title for the entry',
          },
          content: {
            type: 'string',
            description: 'Updated content',
          },
          domain: {
            type: 'string',
            description: 'Domain (default: general)',
          },
        },
        required: ['topic', 'content'],
      },
    },
    {
      name: 'thoughtlayer_search_temporal',
      description:
        'Search with temporal awareness. Understands "last week", "yesterday", "in March", etc.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Query with temporal references',
          },
          top_k: {
            type: 'number',
            description: 'Max results (default: 5)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'thoughtlayer_list_conflicts',
      description:
        'List all entries with contradictions or version history.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'thoughtlayer_health',
      description:
        'Get knowledge base health metrics: total entries, domains, staleness, average importance.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const s = getThoughtLayer();

  try {
    switch (name) {
      case 'thoughtlayer_query': {
        const results = await s.query(args!.query as string, {
          topK: (args?.top_k as number) ?? 5,
          domain: args?.domain as string | undefined,
        });

        const formatted = results.map((r, i) => {
          const sources = [];
          if (r.sources.vector !== undefined) sources.push(`vec:${r.sources.vector.toFixed(3)}`);
          if (r.sources.fts !== undefined) sources.push(`fts:${r.sources.fts.toFixed(3)}`);
          sources.push(`fresh:${r.sources.freshness.toFixed(3)}`);
          sources.push(`imp:${r.sources.importance.toFixed(1)}`);

          return [
            `## ${i + 1}. ${r.entry.title}`,
            `**Domain:** ${r.entry.domain}${r.entry.topic ? '/' + r.entry.topic : ''} | **Score:** ${r.score.toFixed(3)} (${sources.join(', ')})`,
            '',
            r.entry.content,
            '',
          ].join('\n');
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: formatted.length
                ? `Found ${formatted.length} results:\n\n${formatted.join('\n---\n\n')}`
                : 'No results found.',
            },
          ],
        };
      }

      case 'thoughtlayer_add': {
        const entry = await s.add({
          title: args!.title as string,
          content: args!.content as string,
          domain: args!.domain as string,
          topic: args?.topic as string | undefined,
          importance: (args?.importance as number) ?? 0.5,
          tags: (args?.tags as string[]) ?? [],
          keywords: (args?.keywords as string[]) ?? [],
          source_type: 'manual',
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Added entry: **${entry.title}** (${entry.domain}/${entry.topic ?? ''}, id: ${entry.id})`,
            },
          ],
        };
      }

      case 'thoughtlayer_curate': {
        const { entries, result } = await s.curate(
          args!.text as string,
          args?.domain ? { domain: args.domain as string } : undefined
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Curated ${entries.length} entries from text:`,
                '',
                ...entries.map(
                  (e) => `- **${e.title}** (${e.domain}/${e.topic ?? ''}, importance: ${e.importance})`
                ),
                '',
                `Model: ${result.model}, Tokens: ${result.tokensUsed}`,
              ].join('\n'),
            },
          ],
        };
      }

      case 'thoughtlayer_search': {
        const results = await s.search(args!.query as string, (args?.limit as number) ?? 5);

        const formatted = results.map(
          (r, i) =>
            `${i + 1}. **${r.entry.title}** (${r.entry.domain}/${r.entry.topic ?? ''}) [score: ${r.score.toFixed(3)}]\n   ${r.entry.content.slice(0, 200)}...`
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: formatted.length
                ? `Found ${formatted.length} results:\n\n${formatted.join('\n\n')}`
                : 'No results found.',
            },
          ],
        };
      }

      case 'thoughtlayer_list': {
        const entries = s.list({
          domain: args?.domain as string | undefined,
          limit: (args?.limit as number) ?? 20,
        });

        const formatted = entries.map(
          (e) =>
            `- **${e.title}** (${e.domain}/${e.topic ?? ''}): imp: ${e.importance}, v${e.version}`
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: `${entries.length} entries:\n\n${formatted.join('\n')}`,
            },
          ],
        };
      }

      case 'thoughtlayer_update': {
        const topic = (args?.topic as string) ?? 'general';
        const updateContent = args!.content as string;
        const title = (args?.title as string) ?? topic;
        const domain = (args?.domain as string) ?? 'general';

        const { entry, superseded, isContradiction } = addWithVersioning(
          s.database,
          {
            domain,
            topic,
            title,
            content: updateContent,
            source_type: 'mcp',
            importance: 0.6,
          }
        );

        const msg = isContradiction
          ? `Updated **${entry.title}** (supersedes ${superseded!.id})`
          : `Added **${entry.title}** (no prior version found)`;

        return {
          content: [{ type: 'text' as const, text: msg }],
        };
      }

      case 'thoughtlayer_search_temporal': {
        const tQuery = args!.query as string;
        const tTopK = (args?.top_k as number) ?? 5;
        const temporal = parseTemporalRefs(tQuery);

        const tResults = await s.query(tQuery, { topK: tTopK * 2 });

        const boosted = tResults.map(r => ({
          ...r,
          score: r.score * temporalBoost(r.entry.updated_at, temporal.refs),
        })).sort((a, b) => b.score - a.score).slice(0, tTopK);

        const timeInfo = temporal.refs.length > 0
          ? `Time refs: ${temporal.refs.map(r => r.label).join(', ')}\n\n`
          : '';

        const tFormatted = boosted.map((r, i) =>
          `${i + 1}. **${r.entry.title}** [${r.score.toFixed(3)}]: ${r.entry.content.slice(0, 200)}`
        );

        return {
          content: [{
            type: 'text' as const,
            text: tFormatted.length
              ? `${timeInfo}Found ${tFormatted.length} results:\n\n${tFormatted.join('\n\n')}`
              : `${timeInfo}No results found.`,
          }],
        };
      }

      case 'thoughtlayer_list_conflicts': {
        const conflicts = listConflicts(s.database);

        if (conflicts.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No conflicts found.' }],
          };
        }

        const cFormatted = conflicts.map((c, i) =>
          [
            `### Conflict ${i + 1}`,
            `**Current:** ${c.current.title} (${c.current.id})`,
            `> ${c.current.content.slice(0, 200)}`,
            `**Supersedes:** ${c.previous.title} (${c.previous.id})`,
            `> ${c.previous.content.slice(0, 200)}`,
          ].join('\n')
        );

        return {
          content: [{
            type: 'text' as const,
            text: `Found ${conflicts.length} conflict(s):\n\n${cFormatted.join('\n\n')}`,
          }],
        };
      }

      case 'thoughtlayer_health': {
        const health = s.health();
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                '## Knowledge Health',
                '',
                `- **Total:** ${health.total}`,
                `- **Active:** ${health.active}`,
                `- **Archived:** ${health.archived}`,
                `- **Stale (>30d):** ${health.stale}`,
                `- **Avg Importance:** ${health.avgImportance.toFixed(2)}`,
                '',
                '**Domains:**',
                ...Object.entries(health.domains).map(
                  ([k, v]) => `  - ${k}: ${v} entries`
                ),
              ].join('\n'),
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// === RESOURCES (expose knowledge entries) ===

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const s = getThoughtLayer();
  const entries = s.list({ limit: 100 });

  return {
    resources: entries.map((e) => ({
      uri: `thoughtlayer://entry/${e.id}`,
      mimeType: 'text/markdown',
      name: e.title,
      description: `${e.domain}/${e.topic ?? ''}: ${e.summary ?? e.content.slice(0, 100)}`,
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^thoughtlayer:\/\/entry\/(.+)$/);

  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const s = getThoughtLayer();
  const entry = s.get(match[1]);

  if (!entry) {
    throw new Error(`Entry not found: ${match[1]}`);
  }

  const md = [
    '---',
    `title: "${entry.title}"`,
    `domain: ${entry.domain}`,
    entry.topic ? `topic: ${entry.topic}` : null,
    `importance: ${entry.importance}`,
    `confidence: ${entry.confidence}`,
    `tags: [${entry.tags.map((t) => `"${t}"`).join(', ')}]`,
    `version: ${entry.version}`,
    `updated: ${entry.updated_at}`,
    '---',
    '',
    `# ${entry.title}`,
    '',
    entry.content,
    '',
    entry.facts?.length
      ? `## Facts\n\n${entry.facts.map((f) => `- ${f}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text: md,
      },
    ],
  };
});

// === START ===

export async function startMCPServer(projectRoot?: string) {
  if (projectRoot) {
    process.env.THOUGHTLAYER_PROJECT_ROOT = projectRoot;
  }
  return main();
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ThoughtLayer MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

/**
 * OpenAI Agents SDK Tool Definitions
 *
 * Provides tool definitions compatible with the OpenAI Agents API.
 * Three tools: remember, recall, update.
 *
 * @example
 * ```typescript
 * import { createThoughtLayerTools } from 'thoughtlayer/integrations/openai-agents';
 * import { ThoughtLayer } from 'thoughtlayer';
 *
 * const tl = ThoughtLayer.load('./my-project');
 * const tools = createThoughtLayerTools(tl);
 *
 * // Pass to OpenAI Agents API
 * const agent = new Agent({
 *   name: 'my-agent',
 *   tools: tools.definitions,
 * });
 *
 * // Handle tool calls
 * const result = await tools.execute(toolName, args);
 * ```
 */

import type { ThoughtLayer } from '../thoughtlayer.js';
import { addWithVersioning } from '../retrieve/versioning.js';

/** JSON Schema for a tool parameter. */
export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
}

/** OpenAI-compatible tool definition. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolParameter>;
      required: string[];
    };
  };
}

export interface ThoughtLayerToolsConfig {
  /** ThoughtLayer instance. */
  thoughtlayer: ThoughtLayer;
  /** Domain for stored memories. Default: 'agent' */
  domain?: string;
  /** Max results for recall. Default: 5 */
  topK?: number;
}

export interface ThoughtLayerTools {
  /** Tool definitions for the OpenAI Agents API. */
  definitions: ToolDefinition[];
  /** Execute a tool call by name. */
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
}

/**
 * Create ThoughtLayer tool definitions for OpenAI Agents.
 */
export function createThoughtLayerTools(
  thoughtlayerOrConfig: ThoughtLayer | ThoughtLayerToolsConfig
): ThoughtLayerTools {
  const config = 'thoughtlayer' in thoughtlayerOrConfig
    ? thoughtlayerOrConfig as ThoughtLayerToolsConfig
    : { thoughtlayer: thoughtlayerOrConfig as ThoughtLayer };

  const tl = config.thoughtlayer;
  const domain = config.domain ?? 'agent';
  const topK = config.topK ?? 5;

  const definitions: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'remember',
        description:
          'Store a piece of information in long-term memory. Use for facts, decisions, user preferences, or anything worth remembering across conversations.',
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The information to remember',
            },
            title: {
              type: 'string',
              description: 'Short title for the memory (optional, auto-generated if omitted)',
            },
            importance: {
              type: 'number',
              description: 'Importance from 0.0 to 1.0 (default: 0.5)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorisation',
            },
          },
          required: ['content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'recall',
        description:
          'Search long-term memory for relevant information. Use when you need context from previous conversations or stored knowledge.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language query describing what you want to recall',
            },
            top_k: {
              type: 'number',
              description: 'Maximum number of results (default: 5)',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update',
        description:
          'Update an existing fact or piece of knowledge. Creates a new version that supersedes the old one, preserving history.',
        parameters: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic of the fact to update (used to find the existing entry)',
            },
            new_fact: {
              type: 'string',
              description: 'The updated information',
            },
            title: {
              type: 'string',
              description: 'Title for the updated entry',
            },
          },
          required: ['topic', 'new_fact'],
        },
      },
    },
  ];

  async function execute(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    switch (name) {
      case 'remember': {
        const content = args.content as string;
        const title =
          (args.title as string) ??
          (content.length > 60 ? content.slice(0, 57) + '...' : content);

        const entry = await tl.add({
          domain,
          title,
          content,
          importance: (args.importance as number) ?? 0.5,
          tags: (args.tags as string[]) ?? [],
          source_type: 'agent',
        });

        return JSON.stringify({
          status: 'stored',
          id: entry.id,
          title: entry.title,
        });
      }

      case 'recall': {
        const query = args.query as string;
        const results = await tl.query(query, {
          topK: (args.top_k as number) ?? topK,
          domain,
        });

        if (results.length === 0) {
          return JSON.stringify({ status: 'no_results', results: [] });
        }

        return JSON.stringify({
          status: 'found',
          results: results.map((r) => ({
            title: r.entry.title,
            content: r.entry.content,
            score: r.score,
            domain: r.entry.domain,
            updated: r.entry.updated_at,
          })),
        });
      }

      case 'update': {
        const topic = args.topic as string;
        const newFact = args.new_fact as string;
        const title = (args.title as string) ?? topic;

        const { entry, superseded, isContradiction } = addWithVersioning(
          tl.database,
          {
            domain,
            topic,
            title,
            content: newFact,
            source_type: 'agent',
            importance: 0.6,
            tags: ['updated'],
          }
        );

        return JSON.stringify({
          status: isContradiction ? 'updated_with_version' : 'added_new',
          id: entry.id,
          superseded_id: superseded?.id ?? null,
        });
      }

      default:
        return JSON.stringify({ status: 'error', message: `Unknown tool: ${name}` });
    }
  }

  return { definitions, execute };
}

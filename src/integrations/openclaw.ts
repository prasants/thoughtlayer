/**
 * OpenClaw Integration
 *
 * Helper functions for integrating ThoughtLayer with OpenClaw agents.
 * Provides context retrieval for agent tasks.
 */

import { ThoughtLayer } from '../thoughtlayer.js';
import type { RetrievalResult } from '../retrieve/pipeline.js';

export interface AgentContext {
  query: string;
  results: RetrievalResult[];
  formatted: string;
}

/**
 * Get relevant context for an agent task.
 * Returns formatted Markdown suitable for injection into agent prompts.
 */
export async function getContext(
  thoughtlayer: ThoughtLayer,
  query: string,
  options?: {
    topK?: number;
    domain?: string;
    minScore?: number;
  }
): Promise<AgentContext> {
  const topK = options?.topK ?? 3;
  const minScore = options?.minScore ?? 0.1;

  const results = await thoughtlayer.query(query, {
    topK,
    domain: options?.domain,
  });

  // Filter by minimum score
  const filtered = results.filter(r => r.score >= minScore);

  // Format for agent consumption
  const formatted = formatForAgent(filtered);

  return {
    query,
    results: filtered,
    formatted,
  };
}

/**
 * Format retrieval results as Markdown for agent prompts.
 */
function formatForAgent(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return '';
  }

  const lines = ['## Relevant Knowledge\n'];

  for (const r of results) {
    const entry = r.entry;
    lines.push(`### ${entry.title}`);
    lines.push(`*Domain: ${entry.domain}${entry.topic ? '/' + entry.topic : ''} | Importance: ${entry.importance}*\n`);
    lines.push(entry.content);
    if (entry.facts && entry.facts.length > 0) {
      lines.push('\n**Facts:**');
      for (const fact of entry.facts) {
        lines.push(`- ${fact}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Quick context lookup for common agent queries.
 * Caches nothing: each call is fresh retrieval.
 */
export async function quickContext(
  thoughtlayer: ThoughtLayer,
  query: string,
  topK: number = 2
): Promise<string> {
  const { formatted } = await getContext(thoughtlayer, query, { topK });
  return formatted;
}

/**
 * Check if ThoughtLayer is initialised in the workspace.
 */
export function isInitialised(projectRoot: string): boolean {
  try {
    const thoughtlayer = ThoughtLayer.load(projectRoot);
    thoughtlayer.close();
    return true;
  } catch {
    return false;
  }
}

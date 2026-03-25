/**
 * Agent Query Helper
 *
 * Simple wrapper for agents to query ThoughtLayer before handling tasks.
 * Returns formatted context that can be injected into prompts.
 *
 * Usage in agent code:
 *   const context = await getRelevantContext("who is the CTO");
 *   // Returns markdown-formatted knowledge snippets
 */

import { ThoughtLayer } from '../thoughtlayer.js';
import path from 'path';

const PROJECT_ROOT = process.env.THOUGHTLAYER_ROOT ?? process.cwd();

let thoughtlayerInstance: ThoughtLayer | null = null;

function getThoughtLayer(): ThoughtLayer {
  if (!thoughtlayerInstance) {
    thoughtlayerInstance = ThoughtLayer.load(PROJECT_ROOT);
  }
  return thoughtlayerInstance;
}

export interface ContextOptions {
  topK?: number;
  domain?: string;
  minScore?: number;
  format?: 'markdown' | 'json' | 'compact';
}

/**
 * Get relevant knowledge context for a query.
 * Returns formatted text suitable for injection into agent prompts.
 */
export async function getRelevantContext(
  query: string,
  options: ContextOptions = {}
): Promise<string> {
  const thoughtlayer = getThoughtLayer();
  const topK = options.topK ?? 3;
  const minScore = options.minScore ?? 0.1;
  const format = options.format ?? 'markdown';

  const results = await thoughtlayer.query(query, {
    topK,
    domain: options.domain,
  });

  // Filter by minimum score
  const relevant = results.filter(r => r.score >= minScore);

  if (relevant.length === 0) {
    return '';
  }

  if (format === 'json') {
    return JSON.stringify(
      relevant.map(r => ({
        title: r.entry.title,
        domain: r.entry.domain,
        content: r.entry.content,
        score: r.score,
      })),
      null,
      2
    );
  }

  if (format === 'compact') {
    return relevant
      .map(r => `[${r.entry.domain}] ${r.entry.title}: ${r.entry.content.slice(0, 200)}`)
      .join('\n\n');
  }

  // Markdown format (default)
  const sections = relevant.map(r => {
    const header = `### ${r.entry.title}`;
    const meta = `*Domain: ${r.entry.domain}${r.entry.topic ? '/' + r.entry.topic : ''} | Relevance: ${(r.score * 100).toFixed(0)}%*`;
    const content = r.entry.content;
    return `${header}\n${meta}\n\n${content}`;
  });

  return `## Relevant Knowledge (from ThoughtLayer)\n\n${sections.join('\n\n---\n\n')}`;
}

/**
 * Quick check if any knowledge exists for a topic.
 * Useful for deciding whether to query ThoughtLayer at all.
 */
export function hasKnowledge(domain?: string): boolean {
  const thoughtlayer = getThoughtLayer();
  const entries = thoughtlayer.list({ domain, limit: 1 });
  return entries.length > 0;
}

/**
 * Get knowledge health summary.
 */
export function getKnowledgeHealth(): {
  total: number;
  domains: string[];
  avgImportance: number;
} {
  const thoughtlayer = getThoughtLayer();
  const health = thoughtlayer.health();
  return {
    total: health.active,
    domains: Object.keys(health.domains),
    avgImportance: health.avgImportance,
  };
}

/**
 * Close the ThoughtLayer connection.
 * Call this when the agent process is shutting down.
 */
export function closeThoughtLayer(): void {
  if (thoughtlayerInstance) {
    thoughtlayerInstance.close();
    thoughtlayerInstance = null;
  }
}

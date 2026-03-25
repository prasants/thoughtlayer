/**
 * LLM Reranking Module
 *
 * Second-stage reranker that scores candidate entries against a query
 * using an LLM. Takes top-N candidates from the heuristic pipeline and
 * re-sorts them by LLM-assessed relevance.
 *
 * Supports multiple providers: OpenAI, Anthropic, OpenRouter, Ollama.
 * Falls back gracefully: if no LLM is configured, returns candidates unchanged.
 *
 * Design:
 * - Batch scoring: one LLM call per query (not per candidate)
 * - Structured output: JSON array of scores
 * - Token-efficient: only sends title + first 200 chars of content
 * - Configurable: enable/disable, choose model, set candidate count
 */

import type { RetrievalResult } from './pipeline.js';

export interface RerankConfig {
  /** Enable LLM reranking. Default: false */
  enabled: boolean;
  /** LLM provider: 'openai' | 'anthropic' | 'ollama' | 'openrouter' */
  provider?: string;
  /** Model to use. Default: provider-specific (gpt-4o-mini, claude-haiku, etc.) */
  model?: string;
  /** API key (reads from env if not set) */
  apiKey?: string;
  /** Base URL for the API (for Ollama, OpenRouter, custom endpoints) */
  baseUrl?: string;
  /** Number of candidates to rerank. Default: 20 */
  candidateCount?: number;
  /** Timeout in ms. Default: 10000 */
  timeoutMs?: number;
}

export interface RerankResult {
  results: RetrievalResult[];
  reranked: boolean;
  latencyMs: number;
  error?: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-3-5-20241022',
  ollama: 'llama3.2',
  openrouter: 'openai/gpt-4o-mini',
};

function buildPrompt(query: string, candidates: { idx: number; title: string; content: string }[]): string {
  const entries = candidates.map(c =>
    `[${c.idx}] ${c.title}\n${c.content}`
  ).join('\n\n');

  return `You are a relevance scoring engine. Given a query and a list of knowledge entries, score each entry's relevance to the query on a scale of 0-10.

Query: "${query}"

Entries:
${entries}

Return ONLY a JSON array of objects with "idx" and "score" fields. No other text.
Example: [{"idx": 0, "score": 8}, {"idx": 1, "score": 3}]`;
}

function truncateContent(content: string, maxChars: number = 200): string {
  if (content.length <= maxChars) return content;
  return content.substring(0, maxChars).replace(/\s+\S*$/, '') + '...';
}

async function callOpenAI(
  prompt: string,
  config: RerankConfig
): Promise<string> {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('No OpenAI API key');

  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const model = config.model || DEFAULT_MODELS.openai;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 1000,
    }),
    signal: AbortSignal.timeout(config.timeoutMs || 10000),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(
  prompt: string,
  config: RerankConfig
): Promise<string> {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No Anthropic API key');

  const model = config.model || DEFAULT_MODELS.anthropic;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(config.timeoutMs || 10000),
  });

  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = await response.json() as any;
  return data.content?.[0]?.text || '';
}

async function callOllama(
  prompt: string,
  config: RerankConfig
): Promise<string> {
  const baseUrl = config.baseUrl || 'http://localhost:11434';
  const model = config.model || DEFAULT_MODELS.ollama;

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(config.timeoutMs || 30000),
  });

  if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
  const data = await response.json() as any;
  return data.response || '';
}

async function callLLM(prompt: string, config: RerankConfig): Promise<string> {
  const provider = config.provider || detectProvider(config);

  switch (provider) {
    case 'openai':
    case 'openrouter':
      return callOpenAI(prompt, {
        ...config,
        baseUrl: provider === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : config.baseUrl,
        apiKey: provider === 'openrouter'
          ? (config.apiKey || process.env.OPENROUTER_API_KEY)
          : config.apiKey,
      });
    case 'anthropic':
      return callAnthropic(prompt, config);
    case 'ollama':
      return callOllama(prompt, config);
    default:
      throw new Error(`Unknown rerank provider: ${provider}`);
  }
}

function detectProvider(config: RerankConfig): string {
  if (config.apiKey || process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  // Try Ollama as last resort (local, free)
  return 'ollama';
}

function parseScores(response: string): Map<number, number> {
  const scores = new Map<number, number>();

  try {
    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return scores;

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ idx: number; score: number }>;
    for (const item of parsed) {
      if (typeof item.idx === 'number' && typeof item.score === 'number') {
        scores.set(item.idx, Math.max(0, Math.min(10, item.score)));
      }
    }
  } catch {
    // Parse failure: return empty, caller will use original order
  }

  return scores;
}

/**
 * Rerank retrieval results using an LLM.
 *
 * Takes the top candidates from the heuristic pipeline and re-scores them.
 * If reranking fails or is disabled, returns the original results unchanged.
 */
export async function rerank(
  query: string,
  results: RetrievalResult[],
  config: RerankConfig
): Promise<RerankResult> {
  if (!config.enabled || results.length === 0) {
    return { results, reranked: false, latencyMs: 0 };
  }

  const candidateCount = config.candidateCount || 20;
  const candidates = results.slice(0, candidateCount);
  const start = Date.now();

  try {
    const promptCandidates = candidates.map((r, idx) => ({
      idx,
      title: r.entry.title,
      content: truncateContent(r.entry.content),
    }));

    const prompt = buildPrompt(query, promptCandidates);
    const response = await callLLM(prompt, config);
    const scores = parseScores(response);

    if (scores.size === 0) {
      return {
        results,
        reranked: false,
        latencyMs: Date.now() - start,
        error: 'Failed to parse LLM scores',
      };
    }

    // Blend LLM score with original score: 60% LLM, 40% original
    const reranked = candidates.map((r, idx) => {
      const llmScore = scores.get(idx);
      if (llmScore !== undefined) {
        const normalisedLlmScore = llmScore / 10; // Normalise to 0-1
        return {
          ...r,
          score: normalisedLlmScore * 0.6 + r.score * 0.4,
          sources: {
            ...r.sources,
            llmRerank: normalisedLlmScore,
          },
        };
      }
      return r;
    });

    // Sort by new blended score
    reranked.sort((a, b) => b.score - a.score);

    // Append any results beyond the candidate count (unchanged)
    const remaining = results.slice(candidateCount);

    return {
      results: [...reranked, ...remaining],
      reranked: true,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      results,
      reranked: false,
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

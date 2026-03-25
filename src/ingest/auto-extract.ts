/**
 * Automatic Memory Extraction
 *
 * Extracts memorable facts, decisions, and context from conversation text
 * without requiring manual entry. This is what makes memory feel "magical":
 * users just talk, and the system remembers what matters.
 *
 * Supports two modes:
 * 1. Heuristic extraction (fast, no LLM, lower quality)
 * 2. LLM extraction (slower, requires API key, higher quality)
 *
 * Extracts:
 * - Decisions ("we decided to use X", "let's go with Y")
 * - Facts ("X is the CEO", "the deadline is March 15")
 * - Preferences ("I prefer X", "always use Y")
 * - Action items ("we need to X", "remember to Y")
 * - Context ("the project is about X", "the goal is Y")
 */

import type { CreateEntryInput } from '../storage/database.js';

export interface ExtractionResult {
  entries: CreateEntryInput[];
  method: 'heuristic' | 'llm';
  confidence: number;
}

export interface ExtractConfig {
  /** Use LLM for extraction (higher quality). Default: false */
  useLLM?: boolean;
  /** LLM provider: 'openai' | 'anthropic' | 'ollama' */
  provider?: string;
  /** API key (reads from env if not set) */
  apiKey?: string;
  /** Model to use */
  model?: string;
  /** Minimum confidence to include an extraction. Default: 0.5 */
  minConfidence?: number;
  /** Domain to assign to extracted entries. Default: 'conversation' */
  domain?: string;
}

// Patterns for heuristic extraction
const DECISION_PATTERNS = [
  /(?:we|i|let's|let us)\s+(?:decided|agreed|chose|picked|went with|settled on|will use|are using|should use)\s+(.+?)(?:\.|$)/gi,
  /(?:the decision is|decided to|going with|using)\s+(.+?)(?:\.|$)/gi,
  /(?:from now on|moving forward|going forward),?\s+(.+?)(?:\.|$)/gi,
];

const FACT_PATTERNS = [
  /(.+?)\s+(?:is|are|was|were)\s+(?:the|a|an)?\s*(.+?)(?:\.|$)/gi,
  /(?:the|our)\s+(.+?)\s+(?:is|are)\s+(.+?)(?:\.|$)/gi,
];

const PREFERENCE_PATTERNS = [
  /(?:i|we)\s+(?:prefer|like|want|need|always use|never use)\s+(.+?)(?:\.|$)/gi,
  /(?:always|never|don't|do not)\s+(.+?)(?:\.|$)/gi,
];

const ACTION_PATTERNS = [
  /(?:we need to|i need to|must|should|have to|remember to|don't forget to)\s+(.+?)(?:\.|$)/gi,
  /(?:todo|action item|next step|follow up):\s*(.+?)(?:\.|$)/gi,
];

const CONTEXT_PATTERNS = [
  /(?:the project|this|the goal|the objective|we're working on)\s+(?:is|are)\s+(?:about|to|for)?\s*(.+?)(?:\.|$)/gi,
  /(?:context|background|for context):\s*(.+?)(?:\.|$)/gi,
];

function extractWithPattern(
  text: string,
  patterns: RegExp[],
  category: string
): Array<{ content: string; category: string; confidence: number }> {
  const results: Array<{ content: string; category: string; confidence: number }> = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const content = match[1]?.trim();
      if (content && content.length > 10 && content.length < 500) {
        const lc = content.toLowerCase();
        // Skip if exact match or substring of existing
        const isDuplicate = [...seen].some(s => s.includes(lc) || lc.includes(s));
        if (!isDuplicate) {
          seen.add(lc);
          results.push({
            content,
            category,
            confidence: 0.6, // Heuristic extractions get moderate confidence
          });
        }
      }
    }
  }

  return results;
}

function generateTitle(content: string, category: string): string {
  // Take first 50 chars, clean up
  const base = content.substring(0, 50).replace(/\s+/g, ' ').trim();
  const suffix = content.length > 50 ? '...' : '';
  return `${category}: ${base}${suffix}`;
}

/**
 * Extract memorable information using heuristic patterns.
 * Fast, no LLM required, but lower quality.
 */
export function extractHeuristic(text: string, config?: ExtractConfig): ExtractionResult {
  const domain = config?.domain || 'conversation';
  const minConfidence = config?.minConfidence ?? 0.5;

  const extractions: Array<{ content: string; category: string; confidence: number }> = [];

  // Run all pattern extractors
  extractions.push(...extractWithPattern(text, DECISION_PATTERNS, 'Decision'));
  extractions.push(...extractWithPattern(text, FACT_PATTERNS, 'Fact'));
  extractions.push(...extractWithPattern(text, PREFERENCE_PATTERNS, 'Preference'));
  extractions.push(...extractWithPattern(text, ACTION_PATTERNS, 'Action'));
  extractions.push(...extractWithPattern(text, CONTEXT_PATTERNS, 'Context'));

  // Filter by confidence and convert to entries
  const entries: CreateEntryInput[] = extractions
    .filter(e => e.confidence >= minConfidence)
    .map(e => ({
      domain,
      title: generateTitle(e.content, e.category),
      content: e.content,
      importance: e.category === 'Decision' ? 0.8 : e.category === 'Action' ? 0.7 : 0.5,
      tags: [e.category.toLowerCase()],
      source_type: 'auto_extract' as const,
    }));

  return {
    entries,
    method: 'heuristic',
    confidence: entries.length > 0 ? 0.6 : 0,
  };
}

/**
 * Extract memorable information using an LLM.
 * Higher quality but requires API key and is slower.
 */
export async function extractWithLLM(
  text: string,
  config: ExtractConfig
): Promise<ExtractionResult> {
  const domain = config.domain || 'conversation';
  const provider = config.provider || 'openai';
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    // Fall back to heuristic if no API key
    return extractHeuristic(text, config);
  }

  const prompt = `Extract memorable facts, decisions, preferences, and action items from this conversation. Return as JSON array.

Conversation:
${text.substring(0, 4000)}

Extract ONLY information worth remembering long-term. Skip small talk and transient details.

Return JSON array with objects containing:
- "title": Short descriptive title (max 60 chars)
- "content": The full fact/decision/preference
- "category": One of "decision", "fact", "preference", "action", "context"
- "importance": 0.0-1.0 (how important is this to remember?)

Example output:
[
  {"title": "Database Choice: PostgreSQL", "content": "The team decided to use PostgreSQL with pgvector for the v2 API.", "category": "decision", "importance": 0.9},
  {"title": "User prefers dark mode", "content": "User mentioned they always use dark mode in all applications.", "category": "preference", "importance": 0.5}
]

Return ONLY the JSON array, no other text.`;

  try {
    let response: string;

    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 2000,
        }),
      });
      const data = await res.json() as any;
      response = data.choices?.[0]?.message?.content || '';
    } else if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model || 'claude-haiku-3-5-20241022',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
        }),
      });
      const data = await res.json() as any;
      response = data.content?.[0]?.text || '';
    } else {
      return extractHeuristic(text, config);
    }

    // Parse the JSON response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return extractHeuristic(text, config);
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title: string;
      content: string;
      category: string;
      importance: number;
    }>;

    const entries: CreateEntryInput[] = parsed.map(item => ({
      domain,
      title: item.title,
      content: item.content,
      importance: Math.max(0, Math.min(1, item.importance)),
      tags: [item.category],
      source_type: 'auto_extract' as const,
    }));

    return {
      entries,
      method: 'llm',
      confidence: 0.85,
    };
  } catch (err) {
    // Fall back to heuristic on any error
    return extractHeuristic(text, config);
  }
}

/**
 * Main extraction function. Uses LLM if configured, otherwise heuristic.
 */
export async function extract(
  text: string,
  config?: ExtractConfig
): Promise<ExtractionResult> {
  if (config?.useLLM) {
    return extractWithLLM(text, config);
  }
  return extractHeuristic(text, config);
}

/**
 * Extract and store memories from a conversation turn.
 * Call this after each assistant response to build memory automatically.
 */
export async function learnFromConversation(
  userMessage: string,
  assistantResponse: string,
  config?: ExtractConfig
): Promise<ExtractionResult> {
  const conversationText = `User: ${userMessage}\n\nAssistant: ${assistantResponse}`;
  return extract(conversationText, config);
}

/**
 * Curate Engine
 *
 * Takes raw text (conversation, docs, code) and uses LLM structured output
 * to extract knowledge entries. BYOLLM: user provides their own LLM.
 *
 * Phase 0: Uses Anthropic Claude via the Messages API.
 */

export interface CurateOperation {
  action: 'ADD' | 'UPDATE' | 'MERGE' | 'DELETE';
  domain: string;
  topic?: string;
  subtopic?: string;
  title: string;
  content: string;
  summary: string;
  facts: string[];
  tags: string[];
  keywords: string[];
  importance: number;
  confidence: number;
  mergeTargetId?: string;
}

export interface CurateResult {
  operations: CurateOperation[];
  model: string;
  tokensUsed: number;
}

export interface LLMProvider {
  curate(text: string, existingDomains: string[]): Promise<CurateResult>;
}

const CURATE_SYSTEM_PROMPT = `You are a knowledge curator for an AI agent memory system called ThoughtLayer.

Your job is to extract structured knowledge from raw text. For each distinct piece of knowledge, output a JSON operation.

Rules:
1. Extract FACTS, not opinions (unless the opinion itself is the knowledge, e.g. "User prefers X").
2. Deduplicate: if knowledge overlaps with existing domains, suggest UPDATE or MERGE, not ADD.
3. Be specific: "JWT refresh tokens expire after 7 days" is good. "Authentication is important" is useless.
4. Importance scale: 0.0 (trivia) to 1.0 (critical architectural decision or safety constraint).
5. Confidence scale: 0.0 (speculation) to 1.0 (verified fact with source).
6. Tags should be categorical (e.g. "security", "performance", "decision").
7. Keywords should be search-friendly terms a developer would use to find this.

Output ONLY a JSON array of operations. No explanation text.`;

const CURATE_USER_PROMPT = (text: string, existingDomains: string[]) => `
Existing knowledge domains: ${existingDomains.length > 0 ? existingDomains.join(', ') : '(none yet)'}

Text to curate:
---
${text}
---

Extract knowledge entries. Output a JSON array of operations:
[
  {
    "action": "ADD",
    "domain": "string",
    "topic": "string or null",
    "subtopic": "string or null",
    "title": "short descriptive title",
    "content": "detailed knowledge in Markdown",
    "summary": "one-line summary",
    "facts": ["extracted factual statements"],
    "tags": ["categorical tags"],
    "keywords": ["search keywords"],
    "importance": 0.0-1.0,
    "confidence": 0.0-1.0
  }
]

Actions:
- ADD: New knowledge not in any existing domain
- UPDATE: Replaces/extends knowledge in an existing domain (set mergeTargetId if known)
- MERGE: Combines with existing entry (set mergeTargetId)
- DELETE: Marks knowledge as obsolete (set mergeTargetId to the entry to archive)`;

/**
 * Anthropic Claude curate provider.
 */
export class AnthropicCurator implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'claude-sonnet-4-20250514';
  }

  async curate(text: string, existingDomains: string[]): Promise<CurateResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: CURATE_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: CURATE_USER_PROMPT(text, existingDomains) },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const text_content = data.content.find(c => c.type === 'text')?.text ?? '[]';

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text_content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse curate response: ${text_content.slice(0, 200)}`);
    }

    const operations: CurateOperation[] = JSON.parse(jsonMatch[0]);

    return {
      operations,
      model: this.model,
      tokensUsed: data.usage.input_tokens + data.usage.output_tokens,
    };
  }
}

/**
 * OpenAI-compatible curate provider (works with OpenRouter, local models, etc.).
 */
export class OpenAICurator implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model ?? 'gpt-4o-mini';
    this.baseUrl = baseUrl ?? 'https://api.openai.com/v1';
  }

  async curate(text: string, existingDomains: string[]): Promise<CurateResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: CURATE_SYSTEM_PROMPT },
          { role: 'user', content: CURATE_USER_PROMPT(text, existingDomains) },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage: { total_tokens: number };
    };

    const content = data.choices[0]?.message?.content ?? '[]';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse curate response: ${content.slice(0, 200)}`);
    }

    const operations: CurateOperation[] = JSON.parse(jsonMatch[0]);

    return {
      operations,
      model: this.model,
      tokensUsed: data.usage.total_tokens,
    };
  }
}

/**
 * Create a curate provider from config.
 */
export function createCurateProvider(config: {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicCurator(config.apiKey, config.model);
    case 'openai':
    case 'openrouter':
      return new OpenAICurator(config.apiKey, config.model, config.baseUrl);
    default:
      throw new Error(`Unsupported curate provider: ${config.provider}. Supported: anthropic, openai, openrouter`);
  }
}

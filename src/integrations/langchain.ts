/**
 * LangChain Memory Adapter
 *
 * Drop-in replacement for ConversationBufferMemory that persists
 * to ThoughtLayer. Stores conversation turns and retrieves relevant
 * context using semantic + keyword search.
 *
 * @example
 * ```typescript
 * import { ThoughtLayerMemory } from 'thoughtlayer/integrations/langchain';
 * import { ThoughtLayer } from 'thoughtlayer';
 *
 * const tl = ThoughtLayer.load('./my-project');
 * const memory = new ThoughtLayerMemory({ thoughtlayer: tl });
 *
 * // Use with any LangChain chain
 * const chain = new ConversationChain({ llm, memory });
 * ```
 */

import type { ThoughtLayer } from '../thoughtlayer.js';
import type { RetrievalResult } from '../retrieve/pipeline.js';

/**
 * Input/output key configuration for the memory adapter.
 */
export interface ThoughtLayerMemoryConfig {
  /** ThoughtLayer instance to use for storage and retrieval. */
  thoughtlayer: ThoughtLayer;
  /** Key used for human messages in memory variables. Default: 'history' */
  memoryKey?: string;
  /** Key for human input in save context. Default: 'input' */
  inputKey?: string;
  /** Key for AI output in save context. Default: 'output' */
  outputKey?: string;
  /** Domain to store conversation entries under. Default: 'conversation' */
  domain?: string;
  /** Maximum results to retrieve per query. Default: 5 */
  topK?: number;
  /** Whether to return source documents. Default: false */
  returnMessages?: boolean;
  /** Session ID for scoping conversations. Default: 'default' */
  sessionId?: string;
}

/**
 * LangChain-compatible memory class backed by ThoughtLayer.
 *
 * Implements the BaseMemory interface pattern:
 * - `loadMemoryVariables(input)`: retrieves relevant context
 * - `saveContext(input, output)`: stores the conversation turn
 * - `clear()`: archives all conversation entries
 */
export class ThoughtLayerMemory {
  private tl: ThoughtLayer;
  private memoryKey: string;
  private inputKey: string;
  private outputKey: string;
  private domain: string;
  private topK: number;
  private returnMessages: boolean;
  private sessionId: string;

  /** LangChain compatibility: declares which keys this memory provides. */
  get memoryKeys(): string[] {
    return [this.memoryKey];
  }

  constructor(config: ThoughtLayerMemoryConfig) {
    this.tl = config.thoughtlayer;
    this.memoryKey = config.memoryKey ?? 'history';
    this.inputKey = config.inputKey ?? 'input';
    this.outputKey = config.outputKey ?? 'output';
    this.domain = config.domain ?? 'conversation';
    this.topK = config.topK ?? 5;
    this.returnMessages = config.returnMessages ?? false;
    this.sessionId = config.sessionId ?? 'default';
  }

  /**
   * Load memory variables for the current input.
   * Queries ThoughtLayer for relevant conversation history.
   *
   * @param input - The current chain input (used as query context)
   * @returns Object with memoryKey containing formatted history
   */
  async loadMemoryVariables(
    input: Record<string, string>
  ): Promise<Record<string, string | RetrievalResult[]>> {
    const query = input[this.inputKey] ?? Object.values(input)[0] ?? '';

    if (!query) {
      return { [this.memoryKey]: this.returnMessages ? [] : '' };
    }

    const results = await this.tl.query(query, {
      topK: this.topK,
      domain: this.domain,
    });

    if (this.returnMessages) {
      return { [this.memoryKey]: results };
    }

    const formatted = results
      .map((r) => r.entry.content)
      .join('\n\n');

    return { [this.memoryKey]: formatted };
  }

  /**
   * Save a conversation turn to ThoughtLayer.
   * Enriches with keywords automatically.
   *
   * @param input - The human input
   * @param output - The AI output
   */
  async saveContext(
    input: Record<string, string>,
    output: Record<string, string>
  ): Promise<void> {
    const humanMsg = input[this.inputKey] ?? Object.values(input)[0] ?? '';
    const aiMsg = output[this.outputKey] ?? Object.values(output)[0] ?? '';

    const content = `Human: ${humanMsg}\nAssistant: ${aiMsg}`;
    const title = humanMsg.length > 80
      ? humanMsg.slice(0, 77) + '...'
      : humanMsg;

    await this.tl.add({
      domain: this.domain,
      topic: this.sessionId,
      title: `Conversation: ${title}`,
      content,
      source_type: 'conversation',
      importance: 0.4,
      tags: ['langchain', `session:${this.sessionId}`],
    });
  }

  /**
   * Clear conversation memory by archiving all entries for this session.
   */
  async clear(): Promise<void> {
    const entries = this.tl.list({
      domain: this.domain,
      topic: this.sessionId,
      limit: 10000,
    });

    for (const entry of entries) {
      this.tl.archive(entry.id);
    }
  }
}

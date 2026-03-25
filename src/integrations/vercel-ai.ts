/**
 * Vercel AI SDK Memory Provider
 *
 * Adds persistent memory to Vercel AI SDK chat applications.
 * Stores conversation history with auto-chunking and retrieves
 * relevant context on each turn.
 *
 * @example
 * ```typescript
 * import { ThoughtLayerProvider } from 'thoughtlayer/integrations/vercel-ai';
 * import { ThoughtLayer } from 'thoughtlayer';
 * import { streamText } from 'ai';
 *
 * const tl = ThoughtLayer.load('./my-project');
 * const memory = new ThoughtLayerProvider({ thoughtlayer: tl });
 *
 * // Before calling the model, get relevant context
 * const context = await memory.getContext(userMessage);
 *
 * const result = await streamText({
 *   model,
 *   system: `You have access to memory:\n${context}`,
 *   messages,
 * });
 *
 * // After response, save the turn
 * await memory.saveTurn(userMessage, assistantResponse);
 * ```
 */

import type { ThoughtLayer } from '../thoughtlayer.js';

export interface ThoughtLayerProviderConfig {
  /** ThoughtLayer instance. */
  thoughtlayer: ThoughtLayer;
  /** Domain for storing messages. Default: 'chat' */
  domain?: string;
  /** Max results per context retrieval. Default: 5 */
  topK?: number;
  /** Chat/thread ID for scoping. Default: 'default' */
  chatId?: string;
  /** Max characters per stored chunk. Default: 2000 */
  maxChunkSize?: number;
}

/**
 * Memory provider for Vercel AI SDK applications.
 * Handles context retrieval and conversation persistence.
 */
export class ThoughtLayerProvider {
  private tl: ThoughtLayer;
  private domain: string;
  private topK: number;
  private chatId: string;
  private maxChunkSize: number;
  private turnCount: number = 0;

  constructor(config: ThoughtLayerProviderConfig) {
    this.tl = config.thoughtlayer;
    this.domain = config.domain ?? 'chat';
    this.topK = config.topK ?? 5;
    this.chatId = config.chatId ?? 'default';
    this.maxChunkSize = config.maxChunkSize ?? 2000;
  }

  /**
   * Retrieve relevant context for the current user message.
   * Returns formatted string suitable for system prompt injection.
   */
  async getContext(userMessage: string): Promise<string> {
    if (!userMessage.trim()) return '';

    const results = await this.tl.query(userMessage, {
      topK: this.topK,
      domain: this.domain,
    });

    if (results.length === 0) return '';

    return results
      .map((r, i) => `[${i + 1}] ${r.entry.content}`)
      .join('\n\n');
  }

  /**
   * Save a conversation turn. Auto-chunks if content exceeds maxChunkSize.
   */
  async saveTurn(
    userMessage: string,
    assistantResponse: string
  ): Promise<void> {
    this.turnCount++;
    const content = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
    const title = userMessage.length > 80
      ? userMessage.slice(0, 77) + '...'
      : userMessage;

    if (content.length <= this.maxChunkSize) {
      await this.tl.add({
        domain: this.domain,
        topic: this.chatId,
        title: `Turn ${this.turnCount}: ${title}`,
        content,
        source_type: 'conversation',
        importance: 0.4,
        tags: ['vercel-ai', `chat:${this.chatId}`, `turn:${this.turnCount}`],
      });
      return;
    }

    // Auto-chunk large responses
    const chunks = this.chunk(content);
    for (let i = 0; i < chunks.length; i++) {
      await this.tl.add({
        domain: this.domain,
        topic: this.chatId,
        title: `Turn ${this.turnCount} (${i + 1}/${chunks.length}): ${title}`,
        content: chunks[i],
        source_type: 'conversation',
        importance: 0.4,
        tags: ['vercel-ai', `chat:${this.chatId}`, `turn:${this.turnCount}`, `chunk:${i + 1}`],
      });
    }
  }

  /**
   * Save a batch of messages (e.g., full conversation history).
   */
  async saveMessages(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Promise<number> {
    let saved = 0;
    for (let i = 0; i < messages.length - 1; i += 2) {
      if (messages[i].role === 'user' && messages[i + 1]?.role === 'assistant') {
        await this.saveTurn(messages[i].content, messages[i + 1].content);
        saved++;
      }
    }
    return saved;
  }

  /**
   * Get conversation history for a chat.
   */
  getHistory(limit?: number) {
    return this.tl.list({
      domain: this.domain,
      topic: this.chatId,
      limit: limit ?? 50,
    });
  }

  private chunk(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= this.maxChunkSize) {
        chunks.push(remaining);
        break;
      }
      // Find a good break point
      let breakAt = remaining.lastIndexOf('\n', this.maxChunkSize);
      if (breakAt < this.maxChunkSize * 0.5) {
        breakAt = remaining.lastIndexOf(' ', this.maxChunkSize);
      }
      if (breakAt < this.maxChunkSize * 0.5) {
        breakAt = this.maxChunkSize;
      }
      chunks.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    return chunks;
  }
}

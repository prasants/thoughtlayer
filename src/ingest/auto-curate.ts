/**
 * Auto-Curate Engine
 *
 * Watches conversations/text streams and automatically extracts
 * knowledge using the curate LLM. Deduplicates against existing entries.
 *
 * Usage:
 *   const ac = new AutoCurate(thoughtlayer);
 *   ac.ingest("We decided to use PostgreSQL because of pgvector support.");
 *   // Batches text, periodically runs curate, stores new knowledge
 */

import { ThoughtLayer } from '../thoughtlayer.js';

export interface AutoCurateOptions {
  /** Minimum characters before triggering curate (default: 200) */
  minChars?: number;
  /** Maximum characters to batch before force-curating (default: 4000) */
  maxChars?: number;
  /** Debounce interval in ms (default: 30000 = 30s) */
  debounceMs?: number;
  /** Domain override for all curated entries */
  domain?: string;
  /** Filter function: return false to skip text */
  filter?: (text: string) => boolean;
}

export class AutoCurate {
  private thoughtlayer: ThoughtLayer;
  private buffer: string[] = [];
  private bufferChars = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private options: Required<AutoCurateOptions>;
  private processing = false;

  constructor(thoughtlayer: ThoughtLayer, options?: AutoCurateOptions) {
    this.thoughtlayer = thoughtlayer;
    this.options = {
      minChars: options?.minChars ?? 200,
      maxChars: options?.maxChars ?? 4000,
      debounceMs: options?.debounceMs ?? 30000,
      domain: options?.domain ?? '',
      filter: options?.filter ?? (() => true),
    };
  }

  /**
   * Add text to the ingestion buffer.
   * Automatically triggers curate when thresholds are met.
   */
  ingest(text: string): void {
    if (!this.options.filter(text)) return;

    this.buffer.push(text);
    this.bufferChars += text.length;

    // Force curate if buffer is full
    if (this.bufferChars >= this.options.maxChars) {
      this.flush();
      return;
    }

    // Reset debounce timer
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.options.debounceMs);
  }

  /**
   * Force-process the current buffer.
   */
  async flush(): Promise<{ entriesCreated: number; tokensUsed: number } | null> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.bufferChars < this.options.minChars || this.processing) {
      return null;
    }

    this.processing = true;
    const text = this.buffer.join('\n\n');
    this.buffer = [];
    this.bufferChars = 0;

    try {
      const { entries, result } = await this.thoughtlayer.curate(
        text,
        this.options.domain ? { domain: this.options.domain } : undefined
      );

      return {
        entriesCreated: entries.length,
        tokensUsed: result.tokensUsed,
      };
    } catch (err) {
      // Put text back in buffer on failure
      this.buffer.unshift(text);
      this.bufferChars += text.length;
      throw err;
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get current buffer stats.
   */
  stats(): { bufferedChars: number; bufferedChunks: number; isProcessing: boolean } {
    return {
      bufferedChars: this.bufferChars,
      bufferedChunks: this.buffer.length,
      isProcessing: this.processing,
    };
  }

  /**
   * Dispose: flush remaining buffer and clear timer.
   */
  async dispose(): Promise<void> {
    if (this.bufferChars >= this.options.minChars) {
      await this.flush();
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

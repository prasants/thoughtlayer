/**
 * Plugin / Middleware System
 *
 * Event-based hooks for extending ThoughtLayer without modifying core code.
 * Plugins register via tl.use(plugin) and receive lifecycle events.
 */

import type { CreateEntryInput, KnowledgeEntry } from './storage/database.js';
import type { RetrievalResult, RetrievalOptions } from './retrieve/pipeline.js';

export interface ThoughtLayerPlugin {
  name: string;

  /** Called before an entry is added. Can modify the input. */
  beforeAdd?(input: CreateEntryInput): CreateEntryInput | Promise<CreateEntryInput>;

  /** Called after an entry is added. */
  afterAdd?(entry: KnowledgeEntry): void | Promise<void>;

  /** Called before a query is executed. Can modify options. */
  beforeQuery?(query: string, options: Partial<RetrievalOptions>): Partial<RetrievalOptions> | Promise<Partial<RetrievalOptions>>;

  /** Called after query results are returned. Can modify results. */
  afterQuery?(query: string, results: RetrievalResult[]): RetrievalResult[] | Promise<RetrievalResult[]>;

  /** Called before ingestion starts. */
  beforeIngest?(path: string): void | Promise<void>;

  /** Called after ingestion completes. */
  afterIngest?(path: string, count: number): void | Promise<void>;
}

/**
 * Plugin registry that manages plugin lifecycle.
 */
export class PluginRegistry {
  private plugins: ThoughtLayerPlugin[] = [];

  /**
   * Register a plugin.
   */
  use(plugin: ThoughtLayerPlugin): void {
    this.plugins.push(plugin);
  }

  /**
   * Remove a plugin by name.
   */
  remove(name: string): boolean {
    const idx = this.plugins.findIndex(p => p.name === name);
    if (idx >= 0) {
      this.plugins.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * List registered plugin names.
   */
  list(): string[] {
    return this.plugins.map(p => p.name);
  }

  async runBeforeAdd(input: CreateEntryInput): Promise<CreateEntryInput> {
    let current = input;
    for (const plugin of this.plugins) {
      if (plugin.beforeAdd) {
        current = await plugin.beforeAdd(current);
      }
    }
    return current;
  }

  async runAfterAdd(entry: KnowledgeEntry): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.afterAdd) {
        await plugin.afterAdd(entry);
      }
    }
  }

  async runBeforeQuery(query: string, options: Partial<RetrievalOptions>): Promise<Partial<RetrievalOptions>> {
    let current = options;
    for (const plugin of this.plugins) {
      if (plugin.beforeQuery) {
        current = await plugin.beforeQuery(query, current);
      }
    }
    return current;
  }

  async runAfterQuery(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> {
    let current = results;
    for (const plugin of this.plugins) {
      if (plugin.afterQuery) {
        current = await plugin.afterQuery(query, current);
      }
    }
    return current;
  }

  async runBeforeIngest(path: string): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.beforeIngest) {
        await plugin.beforeIngest(path);
      }
    }
  }

  async runAfterIngest(path: string, count: number): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.afterIngest) {
        await plugin.afterIngest(path, count);
      }
    }
  }
}

/**
 * CrewAI Memory Backend
 *
 * Long-term memory backend for CrewAI multi-agent crews.
 * Supports agent-scoped memory and shared crew memory.
 *
 * @example
 * ```typescript
 * import { ThoughtLayerCrewMemory } from 'thoughtlayer/integrations/crewai';
 * import { ThoughtLayer } from 'thoughtlayer';
 *
 * const tl = ThoughtLayer.load('./my-project');
 * const crewMemory = new ThoughtLayerCrewMemory({
 *   thoughtlayer: tl,
 *   crewId: 'research-crew',
 * });
 *
 * // Agent-scoped memory
 * const agentMemory = crewMemory.forAgent('researcher');
 * await agentMemory.save('Found relevant paper on transformers', { importance: 0.8 });
 * const context = await agentMemory.search('transformers');
 *
 * // Shared crew memory
 * await crewMemory.saveShared('Project goal: analyse market trends', { importance: 0.9 });
 * const shared = await crewMemory.searchShared('project goal');
 * ```
 */

import type { ThoughtLayer } from '../thoughtlayer.js';
import type { KnowledgeEntry } from '../storage/database.js';
import type { RetrievalResult } from '../retrieve/pipeline.js';

export interface CrewMemoryConfig {
  /** ThoughtLayer instance. */
  thoughtlayer: ThoughtLayer;
  /** Unique crew identifier. */
  crewId: string;
  /** Default results per search. Default: 5 */
  topK?: number;
}

export interface SaveOptions {
  importance?: number;
  tags?: string[];
  title?: string;
}

/**
 * Agent-scoped memory within a crew.
 */
export class AgentMemory {
  private tl: ThoughtLayer;
  private crewId: string;
  private agentId: string;
  private topK: number;

  constructor(
    tl: ThoughtLayer,
    crewId: string,
    agentId: string,
    topK: number
  ) {
    this.tl = tl;
    this.crewId = crewId;
    this.agentId = agentId;
    this.topK = topK;
  }

  /** Save a memory scoped to this agent. */
  async save(content: string, options?: SaveOptions): Promise<KnowledgeEntry> {
    const title = options?.title ??
      (content.length > 60 ? content.slice(0, 57) + '...' : content);

    return this.tl.add({
      domain: `crew:${this.crewId}`,
      topic: `agent:${this.agentId}`,
      title,
      content,
      importance: options?.importance ?? 0.5,
      tags: [
        ...(options?.tags ?? []),
        `crew:${this.crewId}`,
        `agent:${this.agentId}`,
      ],
      source_type: 'crewai',
    });
  }

  /** Search this agent's memories. */
  async search(query: string, topK?: number): Promise<RetrievalResult[]> {
    return this.tl.query(query, {
      topK: topK ?? this.topK,
      domain: `crew:${this.crewId}`,
    });
  }

  /** List this agent's memories. */
  list(limit?: number): KnowledgeEntry[] {
    return this.tl.list({
      domain: `crew:${this.crewId}`,
      topic: `agent:${this.agentId}`,
      limit: limit ?? 50,
    });
  }
}

/**
 * Crew-level memory backend with agent scoping.
 */
export class ThoughtLayerCrewMemory {
  private tl: ThoughtLayer;
  private crewId: string;
  private topK: number;
  private agents: Map<string, AgentMemory> = new Map();

  constructor(config: CrewMemoryConfig) {
    this.tl = config.thoughtlayer;
    this.crewId = config.crewId;
    this.topK = config.topK ?? 5;
  }

  /**
   * Get an agent-scoped memory instance.
   * Returns the same instance for repeated calls with the same agentId.
   */
  forAgent(agentId: string): AgentMemory {
    if (!this.agents.has(agentId)) {
      this.agents.set(
        agentId,
        new AgentMemory(this.tl, this.crewId, agentId, this.topK)
      );
    }
    return this.agents.get(agentId)!;
  }

  /** Save to shared crew memory (visible to all agents). */
  async saveShared(content: string, options?: SaveOptions): Promise<KnowledgeEntry> {
    const title = options?.title ??
      (content.length > 60 ? content.slice(0, 57) + '...' : content);

    return this.tl.add({
      domain: `crew:${this.crewId}`,
      topic: 'shared',
      title,
      content,
      importance: options?.importance ?? 0.6,
      tags: [
        ...(options?.tags ?? []),
        `crew:${this.crewId}`,
        'shared',
      ],
      source_type: 'crewai',
    });
  }

  /** Search across all crew memory (shared + all agents). */
  async searchShared(query: string, topK?: number): Promise<RetrievalResult[]> {
    return this.tl.query(query, {
      topK: topK ?? this.topK,
      domain: `crew:${this.crewId}`,
    });
  }

  /** List all shared crew memories. */
  listShared(limit?: number): KnowledgeEntry[] {
    return this.tl.list({
      domain: `crew:${this.crewId}`,
      topic: 'shared',
      limit: limit ?? 50,
    });
  }

  /** Get health metrics for the crew's knowledge base. */
  health() {
    return this.tl.health();
  }
}

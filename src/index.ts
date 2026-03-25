/**
 * ThoughtLayer: Memory Infrastructure for AI Agents
 *
 * Remember everything. Retrieve what matters.
 */

export { ThoughtLayerDatabase } from './storage/database.js';
export type { KnowledgeEntry, CreateEntryInput, SearchOptions } from './storage/database.js';
export { retrieve } from './retrieve/pipeline.js';
export type { RetrievalResult, RetrievalOptions } from './retrieve/pipeline.js';
export { cosineSimilarity, vectorSearch } from './retrieve/vector.js';
export { createEmbeddingProvider, autoDetectEmbeddingProvider, OpenAIEmbeddings, OllamaEmbeddings, EmbeddingCache } from './retrieve/embeddings.js';
export type { EmbeddingProvider } from './retrieve/embeddings.js';
export { createCurateProvider, AnthropicCurator, OpenAICurator } from './ingest/curate.js';
export type { CurateOperation, CurateResult, LLMProvider } from './ingest/curate.js';
export { ThoughtLayer } from './thoughtlayer.js';
export { AutoCurate } from './ingest/auto-curate.js';
export type { AutoCurateOptions } from './ingest/auto-curate.js';
export { extractEnrichmentKeywords } from './ingest/enrich.js';
export { extractRelationships } from './ingest/relationships.js';
export type { Relationship } from './ingest/relationships.js';
export { graphBoost, extractQueryEntities } from './retrieve/graph.js';
export { ingestFiles, watchAndIngest } from './ingest/files.js';
export type { IngestOptions, IngestResult } from './ingest/files.js';

// OpenClaw agent integration
export { getContext, quickContext, isInitialised } from './integrations/openclaw.js';
export type { AgentContext } from './integrations/openclaw.js';

// Framework integrations
export { ThoughtLayerMemory } from './integrations/langchain.js';
export type { ThoughtLayerMemoryConfig } from './integrations/langchain.js';
export { ThoughtLayerProvider } from './integrations/vercel-ai.js';
export type { ThoughtLayerProviderConfig } from './integrations/vercel-ai.js';
export { createThoughtLayerTools } from './integrations/openai-agents.js';
export type { ThoughtLayerTools, ToolDefinition } from './integrations/openai-agents.js';
export { ThoughtLayerCrewMemory, AgentMemory } from './integrations/crewai.js';
export type { CrewMemoryConfig } from './integrations/crewai.js';

// OpenClaw plugin
export { createOpenClawPlugin } from './integrations/openclaw-plugin.js';
export type { OpenClawPluginOptions, OpenClawPluginAPI } from './integrations/openclaw-plugin.js';

// LLM reranking
export { rerank } from './retrieve/rerank.js';
export type { RerankConfig, RerankResult } from './retrieve/rerank.js';

// Automatic memory extraction
export { extract, extractHeuristic, extractWithLLM, learnFromConversation } from './ingest/auto-extract.js';
export type { ExtractionResult, ExtractConfig } from './ingest/auto-extract.js';

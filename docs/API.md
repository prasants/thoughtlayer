# ThoughtLayer API Reference

## ThoughtLayer Class

The main entry point. Wires storage, retrieval, and ingestion together.

### Constructor

```typescript
new ThoughtLayer(config: ThoughtLayerConfig)
```

#### ThoughtLayerConfig

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `projectRoot` | `string` | Yes | Path to project directory |
| `embedding` | `object` | No | Embedding provider config |
| `embedding.provider` | `string` | Yes | `'openai'` \| `'ollama'` |
| `embedding.apiKey` | `string` | No | API key (env var fallback) |
| `embedding.model` | `string` | No | Model name override |
| `embedding.baseUrl` | `string` | No | Custom endpoint |
| `curate` | `object` | No | LLM provider for curate |
| `curate.provider` | `string` | Yes | `'anthropic'` \| `'openai'` \| `'openrouter'` |
| `curate.apiKey` | `string` | Yes | API key |
| `curate.model` | `string` | No | Model name override |

### Static Methods

#### `ThoughtLayer.init(projectRoot, config?)`

Initialise a new ThoughtLayer project. Creates `.thoughtlayer/` directory and config.

```typescript
const memory = ThoughtLayer.init('./my-project', {
  embedding: { provider: 'openai', apiKey: 'sk-...' },
});
```

**Returns:** `ThoughtLayer`

#### `ThoughtLayer.load(projectRoot)`

Load an existing project from disk.

```typescript
const memory = ThoughtLayer.load('./my-project');
```

**Returns:** `ThoughtLayer`  
**Throws:** If no `.thoughtlayer/config.json` found.

#### `ThoughtLayer.loadWithAutoDetect(projectRoot)`

Load with automatic embedding provider detection. Tries Ollama first, falls back to OpenAI.

```typescript
const memory = await ThoughtLayer.loadWithAutoDetect('./my-project');
```

**Returns:** `Promise<ThoughtLayer>`

### Instance Methods

#### `add(input: CreateEntryInput): Promise<KnowledgeEntry>`

Add a knowledge entry. Auto-chunks large documents when embeddings are configured.

```typescript
const entry = await memory.add({
  domain: 'architecture',
  title: 'Database Choice',
  content: 'Using PostgreSQL with pgvector.',
  importance: 0.8,
  tags: ['database'],
});
```

#### `query(query: string, options?: Partial<RetrievalOptions>): Promise<RetrievalResult[]>`

Semantic search using the full retrieval pipeline.

```typescript
const results = await memory.query('what database do we use?', {
  topK: 5,
  domain: 'architecture',
  weights: { rrf: 0.75, freshness: 0.05, importance: 0.20 },
});
```

#### `search(query: string, limit?: number): Promise<RetrievalResult[]>`

Full retrieval pipeline without requiring embeddings.

#### `searchRaw(query: string, limit?: number): KnowledgeEntry[]`

Raw FTS5/BM25 search. For debugging.

#### `curate(text: string, options?: { domain?: string }): Promise<{ entries: KnowledgeEntry[], result: CurateResult }>`

LLM-powered knowledge extraction. Requires a curate provider.

```typescript
const { entries } = await memory.curate(
  'We switched from REST to GraphQL for mobile.'
);
```

#### `list(options?: SearchOptions): KnowledgeEntry[]`

List entries with filters.

```typescript
const entries = memory.list({ domain: 'architecture', limit: 10 });
```

#### `get(id: string): KnowledgeEntry | undefined`

Get a single entry by ID.

#### `update(id: string, updates: Partial<CreateEntryInput>): Promise<KnowledgeEntry | undefined>`

Update an entry. Re-embeds if title or content changed.

#### `archive(id: string): boolean`

Soft-delete an entry.

#### `health(): HealthMetrics`

Knowledge base health metrics.

```typescript
const h = memory.health();
// { total: 42, active: 40, stale: 2, domains: { api: 5, auth: 8 } }
```

#### `count(): number`

Total entry count.

#### `rebuild(options?): Promise<{ enriched: number, embedded: number, total: number }>`

Re-run enrichment and regenerate embeddings for all entries.

#### `embedAll(): Promise<number>`

Embed all entries that don't have embeddings yet.

#### `hasEmbeddings(): boolean`

Check if an embedding provider is configured.

#### `embeddingInfo(): { model: string, dimensions: number } | null`

Get embedding provider info.

#### `close(): void`

Close the database connection.

---

## Types

### KnowledgeEntry

```typescript
interface KnowledgeEntry {
  id: string;
  project_id: string;
  version: number;
  domain: string;
  topic: string | null;
  subtopic: string | null;
  title: string;
  content: string;
  content_hash: string;
  summary: string | null;
  facts: string[];
  tags: string[];
  keywords: string[];
  relations: Relation[];
  source_type: string;
  source_ref: string | null;
  importance: number;      // 0.0–1.0
  confidence: number;      // 0.0–1.0
  freshness_at: string;
  access_count: number;
}
```

### CreateEntryInput

```typescript
interface CreateEntryInput {
  domain: string;
  topic?: string;
  subtopic?: string;
  title: string;
  content: string;
  summary?: string;
  facts?: string[];
  tags?: string[];
  keywords?: string[];
  relations?: Relation[];
  source_type?: string;
  source_ref?: string;
  importance?: number;     // default: 0.5
  confidence?: number;     // default: 0.5
}
```

### RetrievalResult

```typescript
interface RetrievalResult {
  entry: KnowledgeEntry;
  score: number;
  sources: {
    vector?: number;
    fts?: number;
    freshness?: number;
    importance?: number;
  };
}
```

### RetrievalOptions

```typescript
interface RetrievalOptions {
  query: string;
  queryEmbedding?: Float32Array;
  domain?: string;
  tags?: string[];
  topK?: number;                    // default: 5
  freshnessHalfLifeDays?: number;   // default: 30
  weights?: {
    rrf?: number;          // default: 0.75
    freshness?: number;    // default: 0.05
    importance?: number;   // default: 0.20
  };
}
```

### SearchOptions

```typescript
interface SearchOptions {
  domain?: string;
  topic?: string;
  tags?: string[];
  status?: string;
  minImportance?: number;
  limit?: number;
  offset?: number;
}
```

---

## Integration APIs

### LangChain: ThoughtLayerMemory

```typescript
import { ThoughtLayerMemory } from 'thoughtlayer';

new ThoughtLayerMemory(config: ThoughtLayerMemoryConfig)
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `thoughtlayer` | `ThoughtLayer` | required | ThoughtLayer instance |
| `memoryKey` | `string` | `'history'` | Output key for memory variables |
| `inputKey` | `string` | `'input'` | Key for human input |
| `outputKey` | `string` | `'output'` | Key for AI output |
| `domain` | `string` | `'conversation'` | Storage domain |
| `topK` | `number` | `5` | Max results per query |
| `returnMessages` | `boolean` | `false` | Return raw RetrievalResult[] |
| `sessionId` | `string` | `'default'` | Session scope |

**Methods:**
- `loadMemoryVariables(input)`: Retrieve relevant context
- `saveContext(input, output)`: Store a conversation turn
- `clear()`: Archive all entries for this session

### Vercel AI: ThoughtLayerProvider

```typescript
import { ThoughtLayerProvider } from 'thoughtlayer';

new ThoughtLayerProvider(config: ThoughtLayerProviderConfig)
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `thoughtlayer` | `ThoughtLayer` | required | ThoughtLayer instance |
| `domain` | `string` | `'chat'` | Storage domain |
| `topK` | `number` | `5` | Max results |
| `chatId` | `string` | `'default'` | Chat/thread scope |
| `maxChunkSize` | `number` | `2000` | Max chars per chunk |

**Methods:**
- `getContext(userMessage)`: Retrieve relevant context string
- `saveTurn(userMessage, assistantResponse)`: Store a turn
- `saveMessages(messages)`: Batch save
- `getHistory(limit?)`: Get conversation history

### OpenAI Agents: createThoughtLayerTools

```typescript
import { createThoughtLayerTools } from 'thoughtlayer';

const tools = createThoughtLayerTools(thoughtlayer | config);
```

**Returns:** `{ definitions: ToolDefinition[], execute: (name, args) => Promise<string> }`

**Tools provided:**
- `remember`: Store information (params: content, title?, importance?, tags?)
- `recall`: Search memory (params: query, top_k?)
- `update`: Update a fact with versioning (params: topic, new_fact, title?)

### CrewAI: ThoughtLayerCrewMemory

```typescript
import { ThoughtLayerCrewMemory } from 'thoughtlayer';

const crew = new ThoughtLayerCrewMemory(config: CrewMemoryConfig);
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `thoughtlayer` | `ThoughtLayer` | required | ThoughtLayer instance |
| `crewId` | `string` | required | Unique crew identifier |
| `topK` | `number` | `5` | Default results per search |

**Methods:**
- `forAgent(agentId)`: Get agent-scoped `AgentMemory`
- `saveShared(content, options?)`: Save to shared crew memory
- `searchShared(query, topK?)`: Search all crew memory
- `listShared(limit?)`: List shared entries
- `health()`: Knowledge base health

**AgentMemory methods:**
- `save(content, options?)`: Save agent-scoped memory
- `search(query, topK?)`: Search agent's memories
- `list(limit?)`: List agent's entries

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `thoughtlayer init [options]` | Initialise project |
| `thoughtlayer ingest <dir> [--watch]` | Ingest files |
| `thoughtlayer query <query> [--top-k N] [--domain D] [--json]` | Hybrid search |
| `thoughtlayer search <term> [--limit N]` | Keyword search |
| `thoughtlayer add <content> [--domain D] [--title T] [--importance N] [--tags t1,t2]` | Add entry |
| `thoughtlayer curate <text> [--domain D]` | LLM extraction |
| `thoughtlayer list [--domain D] [--limit N]` | List entries |
| `thoughtlayer status` | Ingestion status |
| `thoughtlayer health` | Health metrics |

---

## MCP Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `thoughtlayer_query` | `query`, `top_k?`, `domain?` | Full retrieval pipeline |
| `thoughtlayer_add` | `title`, `content`, `domain?`, `importance?`, `tags?` | Add entry |
| `thoughtlayer_curate` | `text`, `domain?` | LLM extraction |
| `thoughtlayer_search` | `query`, `limit?` | Keyword search |
| `thoughtlayer_list` | `domain?`, `limit?` | List entries |
| `thoughtlayer_health` | (none) | Health metrics |

MCP resources: `thoughtlayer://entry/{id}`: browse entries by URI.

## Embedding Compression

### `db.compress(codec?: string)`

Compress all embeddings in-place using the specified codec. Default: `'int8'`.

Returns `{ compressed: number, skipped: number, savedBytes: number }`.

```typescript
const tl = ThoughtLayer.load('.');
const db = (tl as any).db;
const result = db.compress('int8');
// { compressed: 150, skipped: 0, savedBytes: 345600 }
```

### `db.embeddingStats()`

Returns `{ count: number, totalBytes: number, codec: string }`.

### CLI

```bash
thoughtlayer compress              # Compress to int8 (default)
thoughtlayer compress --codec raw  # Restore to raw (reversible)
thoughtlayer benchmark             # Measure recall, storage, latency impact
```

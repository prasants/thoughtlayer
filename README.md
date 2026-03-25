# ThoughtLayer

**Persistent, searchable memory for AI agents.** Local-first. Works without API keys. Five lines of code to integrate.

[![npm](https://img.shields.io/npm/v/thoughtlayer)](https://www.npmjs.com/package/thoughtlayer)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```typescript
import { ThoughtLayer } from 'thoughtlayer';

const memory = ThoughtLayer.init('./my-project');
await memory.add({ domain: 'user', title: 'Preference', content: 'Prefers dark mode' });
const results = await memory.query('what does the user prefer?');
console.log(results[0].entry.content); // "Prefers dark mode"
```

## Why ThoughtLayer?

Context windows end. Sessions expire. The knowledge your agent accumulated over 50 turns vanishes. Most "memory" solutions solve this by shipping your data to someone else's cloud and charging you per query.

ThoughtLayer takes a different approach:

- **Local-first**: SQLite + FTS5. Your data stays on your machine. No external database, no vendor lock-in.
- **Works without API keys**: The keyword engine alone delivers strong retrieval. Embeddings improve it further, but they are optional.
- **Real retrieval, not vibes**: Seven signals combined via weighted Reciprocal Rank Fusion: vector similarity, BM25 keyword matching, query term overlap, entity resolution, knowledge graph traversal, freshness decay, and importance scoring.
- **Auto-built knowledge graph**: Every entry you add gets its relationships extracted automatically. "Sarah leads the Platform team" becomes a traversable graph edge. No manual wiring.
- **Constant cost**: Finding the 5 most relevant entries out of 10,000 costs the same as finding them out of 100. No per-query LLM calls.
- **BYOLLM**: Ollama (recommended), OpenAI, Anthropic, OpenRouter. Use whatever you already have.

## Install

```bash
npm install thoughtlayer
```

## Quick Start

### CLI

```bash
# Initialise
thoughtlayer init

# Ingest your docs
thoughtlayer ingest ./docs

# Query (no API keys needed)
thoughtlayer query "what database are we using"

# LLM-powered knowledge extraction
export ANTHROPIC_API_KEY=sk-ant-...
thoughtlayer curate "We decided to use PostgreSQL for pgvector support."
```

### TypeScript SDK

```typescript
import { ThoughtLayer } from 'thoughtlayer';

// Initialise with Ollama (recommended: free, local, fast)
const memory = ThoughtLayer.init('./my-project', {
  embedding: { provider: 'ollama', model: 'nomic-embed-text' },
});

// Store knowledge (relationships auto-extracted)
await memory.add({
  domain: 'architecture',
  title: 'Database Choice',
  content: 'Using PostgreSQL with pgvector for embeddings.',
  importance: 0.8,
  tags: ['database'],
});

// Retrieve (vector + keyword + graph + freshness + importance)
const results = await memory.query('what database do we use?');
results.forEach(r => console.log(`${r.entry.title}: ${r.score.toFixed(3)}`));

// LLM-powered extraction from raw text
const { entries } = await memory.curate(
  'We switched from REST to GraphQL for the mobile API.'
);
```

## Features

### Retrieval Pipeline

Most tools solve the memory problem by dumping everything into context. At 50 entries, that works. At 500, you are burning tokens. At 5,000, it breaks entirely. ThoughtLayer retrieves only what the query actually needs:

```
Query → Keyword Search (FTS5/BM25)
      → Vector Search (cosine similarity, optional)
      → Query Term Overlap
      → Entity Resolution (fuzzy name matching)
      → Knowledge Graph Traversal (auto-extracted relationships)
      → Metadata Filter (domain, tags, importance)
            ↓
      Weighted Reciprocal Rank Fusion
            ↓
      Freshness Decay + Importance Weighting
            ↓
      Top-K Results
```

### Knowledge Graph

Every entry you add gets its relationships extracted automatically. ThoughtLayer identifies:

- **Role relationships**: "Sarah is the lead of Platform" → `(Sarah, lead, Platform)`
- **Action relationships**: "Alex works on authentication" → `(Alex, works_on, authentication)`
- **Dependencies**: "The API uses Clerk for auth" → `(API, uses, Clerk)`
- **Co-occurrence**: Entities mentioned in the same entry are weakly linked

When you query "who works on Platform?", the graph traverses these edges to surface Sarah, even if "Platform" does not appear in the FTS index. No configuration needed; it happens on every `add()` and `update()`.

### Ingest-Time Enrichment

Keywords are extracted automatically at write time: proper nouns, role patterns, action verbs, and synonym bridges. You never need to tag anything manually.

### Auto-Chunking

Long documents are split into overlapping chunks with parent-child linking. Each chunk gets its own embedding, so retrieval is precise even when the answer sits in paragraph 47 of a 200-paragraph document.

### Query Intent Detection

The query "who handles authentication?" is a different kind of question from "what happened yesterday?" ThoughtLayer classifies intent (who, when, what, how, latest) and adjusts domain and freshness boosts accordingly. No LLM calls required.

### Temporal Awareness

"What changed last week" and "decisions in March" are parsed into time ranges and matched against entry timestamps. Time-aware retrieval without a separate temporal index.

### Entity Resolution

"John" finds "John Smith, backend engineer". Partial names, aliases, and fuzzy matching are built in.

### Fact Versioning

Facts change. When they do, ThoughtLayer detects the contradiction, creates a versioned entry, and links old to new with a supersedes relation. You always get the latest version first, with full history available.

## Embeddings

ThoughtLayer works without embeddings, but they make retrieval significantly better, especially for vocabulary gap queries (where the user's phrasing differs from how the knowledge is stored).

**Recommended: Ollama with nomic-embed-text.** Free, local, no API keys, and produces well-separated similarity scores that fuse cleanly with keyword search.

```bash
# Install Ollama (https://ollama.com)
ollama pull nomic-embed-text

# Initialise with Ollama
thoughtlayer init --embedding-provider ollama
```

OpenAI embeddings also work, but tend to produce compressed similarity ranges (0.2-0.4 for diverse content), which makes threshold-based filtering less effective.

| Provider | Cost | Privacy | Quality |
|----------|------|---------|---------|
| Ollama (nomic-embed-text) | Free | Local | Best for ThoughtLayer |
| OpenAI (text-embedding-3-small) | $0.02/1M tokens | Cloud | Good |
| None | Free | Local | Keyword-only retrieval |

## Framework Integrations

### LangChain

```typescript
import { ThoughtLayerMemory } from 'thoughtlayer';

const memory = new ThoughtLayerMemory({
  thoughtlayer: ThoughtLayer.load('./my-project'),
  topK: 5,
});

// Drop-in replacement for ConversationBufferMemory
const vars = await memory.loadMemoryVariables({ input: 'tell me about auth' });
await memory.saveContext(
  { input: 'How does auth work?' },
  { output: 'We use JWT with refresh tokens.' }
);
```

### Vercel AI SDK

```typescript
import { ThoughtLayerProvider } from 'thoughtlayer';
import { streamText } from 'ai';

const memory = new ThoughtLayerProvider({
  thoughtlayer: ThoughtLayer.load('./my-project'),
});

const context = await memory.getContext(userMessage);
const result = await streamText({
  model,
  system: `You have memory:\n${context}`,
  messages,
});
await memory.saveTurn(userMessage, assistantResponse);
```

### OpenAI Agents

```typescript
import { createThoughtLayerTools } from 'thoughtlayer';

const tools = createThoughtLayerTools(ThoughtLayer.load('./my-project'));

// Three tools: remember, recall, update
const agent = new Agent({
  name: 'my-agent',
  tools: tools.definitions,
});

// Execute tool calls
const result = await tools.execute('recall', { query: 'user preferences' });
```

### CrewAI

```typescript
import { ThoughtLayerCrewMemory } from 'thoughtlayer';

const crew = new ThoughtLayerCrewMemory({
  thoughtlayer: ThoughtLayer.load('./my-project'),
  crewId: 'research-crew',
});

// Agent-scoped memory
const agentMem = crew.forAgent('researcher');
await agentMem.save('Found paper on transformers', { importance: 0.8 });

// Shared crew memory
await crew.saveShared('Project goal: market analysis', { importance: 0.9 });
```

### MCP (Claude Desktop, Cursor, Windsurf)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thoughtlayer": {
      "command": "npx",
      "args": ["-y", "thoughtlayer", "mcp"],
      "env": {
        "THOUGHTLAYER_PROJECT_ROOT": "/path/to/project"
      }
    }
  }
}
```

Exposes 6 tools: `thoughtlayer_query`, `thoughtlayer_add`, `thoughtlayer_curate`, `thoughtlayer_search`, `thoughtlayer_list`, `thoughtlayer_health`.

### OpenClaw

```bash
# Install the plugin
npx thoughtlayer openclaw-install
```

Four tools: `thoughtlayer_query`, `thoughtlayer_add`, `thoughtlayer_ingest`, `thoughtlayer_health`. Auto-ingest watches your workspace for changes.

## How It Compares

| Feature | ThoughtLayer | Mem0 | Zep | Letta (MemGPT) |
|---------|-------------|------|-----|----------------|
| Local-first | ✅ SQLite | ❌ Cloud | ❌ Cloud | ✅ Local |
| Works without API keys | ✅ Keyword search | ❌ Needs API | ❌ Needs API | ❌ Needs LLM |
| Knowledge graph | ✅ Auto-extracted | ❌ | ❌ | ❌ |
| Framework integrations | 6 (LC, Vercel, OAI, CrewAI, MCP, OpenClaw) | 3 | 1 | 1 |
| Retrieval signals | 7 (vector, BM25, terms, entity, graph, freshness, importance) | Vector only | Vector + temporal | LLM-managed |
| Auto-chunking | ✅ | ❌ | ✅ | ✅ |
| Fact versioning | ✅ | ❌ | ❌ | ✅ |
| Query intent detection | ✅ No LLM | ❌ | ❌ | ❌ |
| Entity resolution | ✅ Fuzzy | ❌ | ❌ | ❌ |
| npm install to working | ~30 seconds | Minutes + signup | Minutes + signup | Minutes + config |
| Pricing | Free (MIT) | Freemium | Commercial | Open source |

## Performance

Benchmarked on a corpus of 50 entries across 10 domains, with 40 train and 15 held-out validation queries:

| Metric | Keyword Only | + Ollama Embeddings |
|--------|-------------|---------------------|
| Recall@1 (train) | 70.0% | 76.3% |
| Recall@1 (validation) | 56.7% | 73.3% |
| MRR (train) | 86.0% | 93.7% |
| MRR (validation) | 81.9% | 83.3% |
| p50 latency | <5ms | ~200ms |

Tested in production on a workspace with 1,160 entries, 24,824 auto-extracted relationships, and nomic-embed-text embeddings via Ollama. Vector similarity scores range 0.5-0.7 for relevant matches, providing clean separation from irrelevant results.

## CLI Reference

| Command | Description |
|---------|-------------|
| `thoughtlayer init` | Initialise a new project |
| `thoughtlayer ingest <dir>` | Ingest files (dedup, change detection) |
| `thoughtlayer ingest <dir> --watch` | Watch for changes |
| `thoughtlayer query <query>` | Hybrid search |
| `thoughtlayer search <term>` | Keyword-only search |
| `thoughtlayer add <content>` | Add a manual entry |
| `thoughtlayer curate <text>` | LLM-powered extraction |
| `thoughtlayer list` | List entries |
| `thoughtlayer status` | Ingestion status |
| `thoughtlayer health` | Health metrics |
| `thoughtlayer compress` | Compress embeddings (~4x smaller) |
| `thoughtlayer benchmark` | Benchmark codec impact on recall, storage, latency |

## Configuration

### Embedding Providers

```bash
# Local (recommended, free, private)
ollama pull nomic-embed-text
thoughtlayer init --embedding-provider ollama

# Cloud ($0.02/1M tokens)
export OPENAI_API_KEY=sk-...
thoughtlayer init --embedding-provider openai
```

### LLM Providers (for curate)

| Provider | Config | Notes |
|----------|--------|-------|
| Anthropic | `provider: "anthropic"` | Best quality |
| OpenAI | `provider: "openai"` | Cheapest |
| OpenRouter | `provider: "openrouter"` | Any model |

## Storage

```
your-project/
└── .thoughtlayer/
    ├── config.json
    ├── knowledge/        # Markdown files (human-readable, git-friendly)
    └── index/
        └── metadata.db   # SQLite (FTS5 + embeddings + knowledge graph)

### Embedding Compression

Embeddings are the largest part of the database. Int8 scalar quantisation compresses them ~4x with negligible recall impact.

```bash
# Benchmark before compressing
thoughtlayer benchmark

# Compress (raw Float32 → Int8, ~4x smaller)
thoughtlayer compress

# Benchmark after to verify
thoughtlayer benchmark
```

New projects use Int8 by default. Existing projects can compress in-place. Reversible: `thoughtlayer compress --codec raw` restores full precision.
```

## Documentation

- [API Reference](docs/api.md)
- [Architecture](docs/ARCHITECTURE.md)
- [MCP Setup](docs/MCP.md)
- [Agent Integration Guide](docs/AGENT_INTEGRATION.md)

## Contributing

```bash
git clone https://github.com/prasants/thoughtlayer.git
cd thoughtlayer
npm install --include=dev
npm run build
npx vitest run
```

PRs welcome. Please include tests.

## License

MIT. See [LICENSE](LICENSE).

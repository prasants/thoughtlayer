# Getting Started

## Install

```bash
npm install -g thoughtlayer
```

## Initialise a project

```bash
cd your-project
thoughtlayer init
```

This creates a `.thoughtlayer/` directory with a SQLite database and config.

**No API keys needed.** ThoughtLayer works out of the box with a hybrid keyword search engine (92.5% Recall@1 on our benchmark). Embeddings are optional: add Ollama or OpenAI later for semantic search.

## Add knowledge

### From files (recommended)

```bash
# Ingest a directory of markdown/text files
thoughtlayer ingest ./docs

# Watch for changes
thoughtlayer ingest ./docs --watch
```

Files are tracked by content hash. Re-running `ingest` only processes changed files.

### Manual entries

```bash
thoughtlayer add "PostgreSQL chosen for pgvector support" --domain architecture --importance 0.9
```

### LLM-powered curate

```bash
echo "We decided to use Hono because..." | thoughtlayer curate -
```

Requires `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The LLM extracts structured knowledge from raw text.

## Query

```bash
# Semantic + keyword search (hybrid)
thoughtlayer query "how do we handle auth?"

# Keyword-only (no API key needed)
thoughtlayer search "authentication jwt"
```

## Check status

```bash
thoughtlayer health    # Knowledge health metrics
thoughtlayer status    # Ingestion status, tracked files
thoughtlayer list      # List entries
```

## Use as MCP server

```bash
thoughtlayer-mcp
```

Exposes ThoughtLayer as a [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP-compatible client (Claude Desktop, Cursor, etc.) can query your knowledge base.

## Local embeddings (Ollama)

For fully offline operation:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the embedding model
ollama pull nomic-embed-text

# Initialise with Ollama
thoughtlayer init --embedding-provider ollama
```

ThoughtLayer auto-detects Ollama on `localhost:11434`. Set `OLLAMA_HOST` to override.

## Programmatic API

```typescript
import { ThoughtLayer } from 'thoughtlayer';

const tl = ThoughtLayer.load('.');

// Add knowledge
await tl.add({
  domain: 'architecture',
  title: 'Database choice',
  content: 'PostgreSQL with pgvector for embeddings',
  importance: 0.9,
});

// Query
const results = await tl.query('what database do we use?');
console.log(results[0].entry.title); // "Database choice"

tl.close();
```

## Embedding Compression

Once you have entries with embeddings, you can compress them for ~4x storage savings:

```bash
# See current storage usage
thoughtlayer health

# Benchmark before compressing
thoughtlayer benchmark

# Compress embeddings (Int8 scalar quantisation)
thoughtlayer compress

# Verify no recall impact
thoughtlayer benchmark
```

Compression is reversible: `thoughtlayer compress --codec raw` restores full precision.

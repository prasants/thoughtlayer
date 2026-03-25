# OpenClaw Integration

ThoughtLayer provides native plugin support for [OpenClaw](https://openclaw.ai), giving your agents persistent memory across sessions with zero configuration.

## Quick Start

```bash
# Install the ThoughtLayer OpenClaw plugin
thoughtlayer openclaw-install

# Restart your OpenClaw gateway
openclaw gateway restart
```

That's it. Your agent now has four new tools.

## Tools

### thoughtlayer_query

Semantic search across your workspace knowledge.

```
Query: "what database are we using"
Result: Database Choice (score: 0.94)
  Team decided on Postgres with pgvector for the v2 rewrite.
```

Features:
- Semantic vector search (when embeddings configured)
- Keyword search (BM25, always available)
- Entity recognition (names, companies, projects)
- Temporal decay (recent knowledge ranks higher)
- Auto-ingests workspace files before every query

### thoughtlayer_add

Store knowledge entries programmatically.

```typescript
// From your agent
thoughtlayer_add({
  content: "Team decided: Kubernetes for production, Docker Compose for dev",
  domain: "decisions",
  title: "Infrastructure Choice"
})
```

### thoughtlayer_ingest

Sync workspace files into the ThoughtLayer index.

```typescript
// Ingest a specific directory
thoughtlayer_ingest({ path: "./memory/" })

// Or ingest default paths (memory/ and workspace root)
thoughtlayer_ingest({})
```

Supports `.md` and `.txt` files. Change detection via content hash, so unchanged files are skipped.

### thoughtlayer_health

Check index health and statistics.

```
Total: 180 entries
Active: 175
Archived: 5
Stale: 12
Domains: { "engineering": 45, "health": 23, "people": 18, ... }
```

## Configuration

The plugin works out of the box, but you can customise behaviour in your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "thoughtlayer": {
        "enabled": true,
        "config": {
          "projectDir": "/path/to/workspace",
          "ingestOnQuery": true,
          "ingestPaths": ["./memory/", "./"]
        }
      }
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `projectDir` | workspace root | ThoughtLayer project directory |
| `ingestOnQuery` | `true` | Ingest workspace files before every query |
| `ingestPaths` | `["memory/", "./"]` | Paths to ingest when `ingestOnQuery` is true |

## How It Works

The plugin uses ThoughtLayer's library API directly (no CLI exec, no shell). This means:

- **Sub-millisecond queries** after initial load
- **No npx overhead** on every call
- **Singleton database connection** (efficient)
- **Async throughout** (non-blocking)

When you call `thoughtlayer_query`:

1. If `ingestOnQuery` is true, scans configured paths for changed files
2. Updates the index with any new or modified content
3. Runs the full retrieval pipeline (vector + keyword + temporal + entity)
4. Returns ranked results

## Replacing memory_search

To use ThoughtLayer as your only memory system (recommended):

```json
{
  "agents": {
    "defaults": {
      "memorySearch": { "enabled": false }
    }
  }
}
```

This disables OpenClaw's built-in memory_search, forcing all memory operations through ThoughtLayer.

## Embeddings

For best results, configure an embedding provider:

**Ollama (local, free, fast)**
```bash
ollama pull nomic-embed-text
# ThoughtLayer auto-detects Ollama
```

**OpenAI**
```bash
export OPENAI_API_KEY=sk-...
# ThoughtLayer auto-detects the key
```

Without embeddings, ThoughtLayer falls back to keyword search (BM25), which still works well for exact matches.

## Manual Installation

If the CLI install doesn't work, you can install manually:

```bash
# Create plugin directory
mkdir -p ~/.openclaw/extensions/thoughtlayer

# Install dependencies
cd ~/.openclaw/extensions/thoughtlayer
npm init -y
npm install thoughtlayer @sinclair/typebox
```

Then create `index.ts`:

```typescript
import { createOpenClawPlugin } from 'thoughtlayer';
export default createOpenClawPlugin('/path/to/workspace');
```

And `openclaw.plugin.json`:

```json
{
  "id": "thoughtlayer",
  "name": "ThoughtLayer Memory",
  "configSchema": { "type": "object", "additionalProperties": true }
}
```

## Troubleshooting

**Plugin not loading**

Check `openclaw plugins doctor` for errors. Common issues:
- Missing `@sinclair/typebox` dependency
- Invalid `openclaw.plugin.json`
- Path escapes in plugin directory

**Slow queries**

First query is slow (initialises database, loads embeddings). Subsequent queries are fast. If consistently slow, check:
- Ollama is running (if using local embeddings)
- Index is healthy (`thoughtlayer health`)

**No results**

Run `thoughtlayer_ingest` to sync your workspace files. Check that files are `.md` or `.txt` and not in an excluded path.

## Next Steps

- [Core Concepts](/docs/concepts): how ThoughtLayer retrieval works
- [CLI Reference](/docs/cli): all available commands
- [TypeScript SDK](/docs/sdk): programmatic API for custom integrations

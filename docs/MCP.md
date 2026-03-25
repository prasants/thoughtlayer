# ThoughtLayer MCP Server

Model Context Protocol server that gives any MCP client (Claude Desktop, Cursor, Windsurf, etc.) access to your ThoughtLayer knowledge base.

## Quick Start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thoughtlayer": {
      "command": "npx",
      "args": ["-y", "thoughtlayer", "mcp"],
      "env": {
        "THOUGHTLAYER_PROJECT_ROOT": "/path/to/your/project",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "thoughtlayer": {
      "command": "thoughtlayer-mcp",
      "env": {
        "THOUGHTLAYER_PROJECT_ROOT": "/path/to/your/project",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "thoughtlayer": {
      "command": "thoughtlayer-mcp",
      "env": {
        "THOUGHTLAYER_PROJECT_ROOT": ".",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## Tools

The MCP server exposes 6 tools:

| Tool | Description |
|------|-------------|
| `thoughtlayer_query` | Semantic + keyword search (the full retrieval pipeline) |
| `thoughtlayer_add` | Add a knowledge entry manually |
| `thoughtlayer_curate` | LLM-powered knowledge extraction from raw text |
| `thoughtlayer_search` | Keyword-only search (FTS5/BM25, no embeddings) |
| `thoughtlayer_list` | List entries with domain/limit filters |
| `thoughtlayer_health` | Knowledge base health metrics |

### thoughtlayer_query

The primary tool. Combines vector similarity, keyword matching, freshness decay, and importance scoring.

```
Query: "what database are we using"
→ Returns top-K entries with scores and source breakdown
```

### thoughtlayer_add

Add structured knowledge directly. No LLM call needed.

```json
{
  "title": "Database Choice",
  "content": "Using PostgreSQL with pgvector for embeddings.",
  "domain": "architecture",
  "importance": 0.8,
  "tags": ["database"]
}
```

### thoughtlayer_curate

Send raw text (meeting notes, Slack messages, commit messages) and the LLM extracts structured knowledge entries automatically.

```json
{
  "text": "In today's standup, we decided to switch from REST to GraphQL for the mobile API."
}
```

## Resources

The server also exposes all knowledge entries as MCP resources. Clients that support resource browsing can navigate entries by title and read the full Markdown content.

Resource URI format: `thoughtlayer://entry/{id}`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `THOUGHTLAYER_PROJECT_ROOT` | Yes | Path to the project containing `.thoughtlayer/` |
| `OPENAI_API_KEY` | For query/add | Needed for embedding generation |
| `ANTHROPIC_API_KEY` | For curate (if using Claude) | Needed for LLM knowledge extraction |

## Testing

```bash
# Send a raw JSON-RPC initialize + query
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"thoughtlayer_query","arguments":{"query":"your question"}}}' | THOUGHTLAYER_PROJECT_ROOT=. node dist/mcp/server.js
```

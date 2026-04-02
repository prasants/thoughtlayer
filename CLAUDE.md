# CLAUDE.md — ThoughtLayer

## What This Is

ThoughtLayer is memory infrastructure for AI agents. Local-first, cloud-optional, BYOLLM. It gives agents persistent, searchable memory backed by SQLite with a 7-signal retrieval pipeline (vector, keyword, entity, graph, temporal, freshness, importance fused via Reciprocal Rank Fusion).

**Version:** 0.6.0
**Language:** TypeScript (strict mode)
**Author:** Prasant Sudhakaran
**Licence:** MIT

## Build & Test

```bash
npm install
npm run build          # tsc → dist/
npm test               # vitest, 244+ tests, all should pass
npm run lint           # eslint src/
npm run benchmark      # performance evaluation
```

Node ≥18 required. Uses ES modules (`"type": "module"` in package.json).

## Architecture

```
src/
├── thoughtlayer.ts         # Main API — add, query, learn, curate, rebuild
├── storage/
│   ├── database.ts         # SQLite (better-sqlite3) + FTS5 + WAL
│   └── schema.ts           # Table definitions, indexes, triggers
├── ingest/
│   ├── files.ts            # Directory scan, dedup via content_hash (SHA-256)
│   ├── curate.ts           # LLM-powered extraction (Anthropic/OpenAI/OpenRouter)
│   ├── auto-extract.ts     # Heuristic fact extraction from conversations
│   ├── chunk.ts            # Auto-chunking large docs (>4KB, 500-term overlap)
│   ├── enrich.ts           # Ingest-time keyword extraction
│   └── relationships.ts    # Regex NLP — 15+ patterns (role, reports_to, uses, etc.)
├── retrieve/
│   ├── pipeline.ts         # Multi-signal fusion (RRF, k=60)
│   ├── vector.ts           # Brute-force cosine similarity (Phase 0)
│   ├── embeddings.ts       # OpenAI + Ollama providers, LRU cache (100 entries)
│   ├── codec.ts            # Embedding codecs: Raw, Int8 (~4x), Polar (~15x), Binary (~32x)
│   ├── entity.ts           # Fuzzy name matching (Levenshtein)
│   ├── graph.ts            # 2-hop relationship traversal
│   ├── intent.ts           # Query intent classification (7 types, regex)
│   ├── temporal.ts         # Time-aware queries ("last week", "March 2025")
│   ├── rerank.ts           # Optional LLM reranking (Phase 1)
│   └── versioning.ts       # Fact versioning, contradiction detection
├── integrations/
│   ├── openclaw-plugin.ts  # Native OpenClaw plugin (5 tools: query, add, ingest, health, preflight)
│   ├── langchain.ts        # LangChain memory adapter
│   ├── vercel-ai.ts        # Vercel AI SDK provider
│   ├── openai-agents.ts    # OpenAI agents tools
│   └── crewai.ts           # CrewAI memory adapter
├── mcp/
│   └── server.ts           # MCP server (9 tools)
└── cli/
    └── index.ts            # Commander-based CLI (12 commands)
```

## Entry Points

- **Library:** `dist/index.js` (exports ThoughtLayer class, types, utilities)
- **CLI:** `dist/cli/index.js` → `thoughtlayer` binary
- **MCP server:** `dist/mcp/server.js` → `thoughtlayer-mcp` binary
- **OpenClaw plugin:** `dist/integrations/openclaw-plugin.js`

## Key Design Decisions

1. **Local-first.** SQLite with WAL journaling. No cloud services required. Works fully offline with keyword search only; embeddings are optional.
2. **Retrieval is the moat.** 7 signals fused via RRF — this is where to invest improvement effort. Currently: vector (cosine), FTS5 (BM25), query term overlap, entity resolution, knowledge graph traversal, temporal awareness, importance scoring.
3. **Graceful degradation.** If embedding provider is down, falls back to keyword-only. If Ollama isn't running, skips vector search. No hard failures from missing optional services.
4. **Human-readable mirror.** Every entry is also written as a Markdown file under `.thoughtlayer/knowledge/`. This means the knowledge base is git-diffable and inspectable.

## Known Issues & Improvement Areas

### Reliability
- **Entity resolution only matches capitalised words** (`graph.ts`). Lowercase names like "john" won't resolve. Needs case-insensitive entity extraction.
- **FTS5 query not escaped for special characters** (`pipeline.ts`). Bracket syntax could cause unexpected results. Should sanitise query input.
- **File ingestion watch mode has no file locking** (`files.ts`). Concurrent writes can create brief duplicates (caught by content_hash eventually, but not ideal).
- **Graph traversal is O(n) per hop** (`graph.ts`). At scale (10K+ entries), 2-hop traversal could get slow. Consider caching or indexing relationship lookups.

### Features
- **Vector search is brute-force** (`vector.ts`). Phase 0 design. sqlite-vss HNSW index is the planned Phase 1 upgrade for sub-linear search.
- **Intent detection is regex-only** (`intent.ts`). Works well for simple queries but misses nuanced multi-intent queries ("latest decision on auth"). Consider lightweight LLM classification or ensemble approach.
- **Reranking is optional and untested in production** (`rerank.ts`). The infrastructure exists but needs real-world validation.
- **No batch embedding API usage** for ingestion. Currently embeds one-at-a-time during ingest. Batch embedding would cut API calls significantly.

### Code Quality
- **Embedding cache uses SHA-256 text hashing** (`embeddings.ts`). Extremely low collision risk but no collision handling.
- **Polar codec angle quantisation** (`codec.ts`). 4-bit angles have max error of pi/16 per dimension pair. For high-dimensional embeddings this averages out, but low-dimensional vectors (< 64 dims) will see measurably higher cosine drift.

## Testing

244+ tests across 24 files. Key test categories:
- Core API (add, query, learn, archive)
- Storage (CRUD, FTS5, content hash dedup)
- Retrieval pipeline (RRF fusion, score normalisation)
- Vector + codec (cosine similarity, Int8/Polar/Binary round-trip, ranking preservation)
- Ingestion (chunking, enrichment, file scanning)
- Knowledge graph (15+ relationship patterns, entity resolution)
- Query intelligence (intent detection, temporal parsing)
- Edge cases (Unicode, long content, special chars)
- Framework integrations (LangChain, Vercel, OpenAI, CrewAI)
- OpenClaw plugin (tool registration, lazy loading)
- Real-world dataset (1,160 entries, 24,824 relationships)

All tests should pass. If any fail, fix before committing.

## Benchmarks

- **Validation recall:** 56.7%
- **MRR:** 83.3%

Run `npm run benchmark` to evaluate. Results in `benchmarks/results.json`.

## Release Process

1. Bump version in `package.json`
2. Update `CHANGELOG.md`
3. `npm run build && npm test`
4. `npm publish`
5. Update the installed copy in Prasant's OpenClaw setup: `npm install -g thoughtlayer@latest`

## Conventions

- British spellings in documentation and comments (organisation, not organization)
- All commits describe the "why", not just the "what"
- Tests before merge. `npm test` must pass clean.
- No external API keys in code. Environment variables only (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).

## What NOT to Change

- The 7-signal retrieval pipeline architecture. Improve individual signals, but don't collapse them.
- SQLite as the storage backend. This is a deliberate local-first choice.
- The Markdown mirror in `.thoughtlayer/knowledge/`. This human-readability is a feature.
- MIT licence.

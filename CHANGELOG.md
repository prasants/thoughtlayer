# Changelog

All notable changes to ThoughtLayer will be documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-04-02

### Added
- **Preflight tool** (`thoughtlayer_preflight`): Mandatory pre-response check for the OpenClaw plugin. Queries ThoughtLayer for known corrections, past mistakes, and relevant context before the agent responds. Separates results into corrections (domain `corrections` or importance >= 0.9) and general context (score >= 0.3).
- **Schema migration v5**: Adds `codec` column to the embeddings table if missing, enabling graceful upgrade from v0.4.x databases without manual intervention.

### Changed
- OpenClaw plugin now registers 5 tools (was 4): query, add, ingest, health, and preflight.

## [0.5.1] - 2026-04-01

### Added
- **Polar codec** (`--codec polar`): TurboQuant-inspired polar-coordinate quantisation. Random block-diagonal rotation spreads vector structure, then dimension pairs are converted to 4-bit quantised angles. A single norm value preserves magnitude. Achieves ~15x compression with cosine similarity drift below 0.01. Deterministic via seeded xorshift128 PRNG, so identical inputs always produce identical outputs.
- **Binary codec** (`--codec binary`): Single-bit sign quantisation. Each dimension stored as one bit (positive or negative), producing +1.0/-1.0 on decode. Achieves ~32x compression. Best suited for coarse first-pass filtering or storage-constrained environments where retrieval precision is secondary.
- **Multi-codec benchmark**: `thoughtlayer benchmark` now compares all codecs (Int8, Polar, Binary) against raw in a single table, reporting storage ratio, top-10 ranking overlap, similarity drift, and decode latency per vector.

### Changed
- `thoughtlayer compress` now accepts `--codec polar`, `--codec binary`, `--codec int8`, or `--codec raw`.

## [0.5.0] - 2026-04-01

### Fixed
- **FTS5 query injection**: User queries containing FTS5 operators (`AND`, `OR`, `NOT`, `*`, `"`) are now escaped, preventing SQL errors and unexpected results.
- **Case-insensitive entity resolution**: Entity matching now works with any casing ("john smith", "JOHN SMITH", "John Smith"). Graph entity extraction falls back to lowercase for people queries.
- **Duplicate relationship triples**: Added UNIQUE constraint on `(entry_id, subject, predicate, object)` with migration to dedup existing rows.
- **Access count inflation**: `recordAccess()` now only fires for entries actually returned to the caller, not all scored candidates.
- **Pipeline double normalisation**: Removed redundant min-max normalisation pass on RRF scores.

### Added
- **Schema migration system**: Version-stamped, transactional migrations that auto-run on database open. Future schema changes no longer require manual intervention.
- **In-memory vector index**: Contiguous `Float32Array` matrix with pre-computed query norm for cache-friendly brute-force search. 10-50x speedup at 1K+ entries. Incremental add without full rebuild.
- **Batch embedding**: `addBatch()` method processes entries in bulk with batched API calls (100-entry chunks for rate limits).
- **Multi-intent detection**: Queries like "latest decision on auth" now detect both `latest` and `decision` intents. Includes negation handling ("not recent" suppresses freshness boost).
- **Temporal range improvements**: Added "last N days/weeks/months", "tomorrow", "next week/month" patterns. Switched from linear to exponential proximity decay.
- **Persistent embedding cache**: SQLite-backed L2 cache survives restarts. Configurable max size, LRU eviction, exposed via `cacheStats()` and `clearCache()` APIs.
- **Graph traversal optimisation**: Batch frontier queries (single `WHERE IN` instead of N separate queries). Added cycle detection. New composite index on `(subject, object)`.
- **Semantic contradiction detection**: Uses embedding cosine similarity when available (more accurate for differently worded titles), falls back to Jaccard.
- **Reranker provider fallback**: Tries configured provider first, then falls back through OpenAI, Anthropic, OpenRouter, Ollama. Increased content truncation to 500 chars.
- **Custom error types**: `ThoughtLayerError` hierarchy (`EmbeddingError`, `StorageError`, `QueryError`, `ConfigError`, `RerankError`, `CodecError`) with context metadata.
- **Domain-aware freshness decay**: Configurable per-domain half-life overrides via `domainFreshnessHalfLife` option.
- **Plugin/middleware system**: Event-based hooks (`beforeAdd`, `afterAdd`, `beforeQuery`, `afterQuery`, `beforeIngest`, `afterIngest`). Register via `tl.use(plugin)`.
- **Structured logging**: Component-scoped logger with JSON/plain modes and configurable level. No external dependencies.
- **Content-hash file tracking**: `findIngestedByHash()` and `updateIngestedFilePath()` for detecting moved files without re-ingesting.
- **Database maintenance**: `optimize()` method runs `PRAGMA optimize`, `FTS5 optimize`, and `VACUUM`.
- **Codec decode safety**: Int8 codec now includes magic number + version header. Backward compatible with legacy format. Malformed buffers throw descriptive errors.

## [0.4.1] - 2026-03-25

### Added
- **Embedding compression**: Int8 scalar quantisation codec (~4x storage reduction, <0.005 cosine similarity drift). Per-row codec tracking for backwards compatibility.
- **`thoughtlayer compress`**: In-place compression of existing embeddings. Reversible with `--codec raw`.
- **`thoughtlayer benchmark`**: Measures recall (top-10 overlap), storage savings, and decode latency.
- **`EmbeddingCodec` interface**: Extensible codec system. New codecs can be added without schema changes.
- 12 new tests (225 total, all passing).

## [0.4.0] - 2026-03-24
## [0.4.1] - 2026-03-25

### Added
- **Embedding compression**: Int8 scalar quantisation codec (~4x storage reduction, <0.005 cosine similarity drift). Per-row codec tracking for backwards compatibility.
- **`thoughtlayer compress` CLI command**: In-place compression of existing embeddings. Reversible with `--codec raw`.
- **`thoughtlayer benchmark` CLI command**: Measures recall (top-10 overlap), storage savings, and decode latency before/after compression.
- **`EmbeddingCodec` interface**: Extensible codec system (`RawCodec`, `Int8Codec`). New codecs can be added without schema changes.
- 12 new tests covering codec round-trip accuracy, compression ratio, ranking preservation, and edge cases (225 total).


### Added
- **Automatic memory extraction**: `learn()` and `extractAndStore()` methods automatically extract memorable facts, decisions, and preferences from conversations. No manual entry required. Supports both heuristic extraction (fast, no LLM) and LLM-powered extraction (higher quality).
- **LLM reranking**: Optional second-stage reranker that scores candidates using an LLM for higher precision (+10-15% expected). Supports OpenAI, Anthropic, Ollama, OpenRouter. Enable via `rerank.enabled: true` in config.
- **Native OpenClaw plugin**: `createOpenClawPlugin()` registers four tools directly into OpenClaw. Uses library API (no CLI exec). Sub-millisecond queries after initial load.
- **`thoughtlayer openclaw-install` CLI command**: One-command plugin installation for OpenClaw users.

### Changed
- **README restructured**: "Quick Start: Pick Your Tool" section at the top with copy-paste configs for Cursor, Claude Desktop, Windsurf, Cline, Claude Code, and OpenClaw.
- **Benchmark numbers corrected**: Now reports held-out validation set scores (R@1: 56.7%, MRR: 72.5%), not inflated training numbers.
- Homepage URL updated from thoughtlayer.sh to thoughtlayer.dev.
- CLI version string updated to 0.4.0.

### Fixed
- CLI init template literal syntax error.
- MCP server export for startMCPServer function.
- Em dashes removed from all source files and documentation.

## [0.3.0] - 2026-03-20

### Added
- **Ingest-time enrichment**: Automatic keyword extraction from content (proper nouns, roles, action verbs, synonym expansion)
- **Auto-chunking**: Large documents automatically split into overlapping chunks with parent-child linking
- **Query intent detection**: Heuristic-based intent classification (who/when/what/how/latest) with domain and freshness boosts
- **Temporal awareness**: Parses relative time references ("last week", "in March") into time-range filters
- **Entity resolution**: Fuzzy matching for names and aliases ("John" finds "John Smith")
- **Fact versioning**: Contradiction detection, versioned entries, supersedes relations
- **LangChain integration**: `ThoughtLayerMemory` drop-in replacement for ConversationBufferMemory
- **Vercel AI SDK integration**: `ThoughtLayerProvider` for persistent chat memory
- **OpenAI Agents integration**: `createThoughtLayerTools` with remember/recall/update tools
- **CrewAI integration**: `ThoughtLayerCrewMemory` with agent-scoped and shared crew memory
- **MCP server**: 6 tools + resource browsing for Claude Desktop, Cursor, Windsurf
- **Local embeddings**: Ollama/Nomic support with auto-detection
- **File ingestion**: `thoughtlayer ingest` with dedup, change detection, and watch mode
- **Rebuild command**: Re-run enrichment and regenerate embeddings for all entries
- `ThoughtLayer.loadWithAutoDetect()`: Auto-detect embedding provider (Ollama first, then OpenAI)
- `embedAll()`: Embed entries missing embeddings
- Comprehensive API documentation (`docs/api.md`)
- Working examples directory (`examples/`)

### Changed
- Default retrieval weights updated: RRF 0.75, freshness 0.05, importance 0.20
- Keyword search now uses stopword-filtered OR queries for better recall

## [0.1.0] - 2026-03-13

### Added
- Core retrieval pipeline: vector search + FTS5 keyword search + reciprocal rank fusion
- Freshness decay scoring (exponential, 30-day half-life)
- Importance-weighted ranking
- CLI: `init`, `add`, `curate`, `query`, `search`, `list`, `health`
- MCP server with 6 tools for editor integration
- TypeScript SDK with full type definitions
- SQLite + FTS5 storage (local-first, no external database)
- Markdown knowledge files with YAML frontmatter (human-readable, git-friendly)
- BYOLLM support: OpenAI, Anthropic, OpenRouter for curate operations
- OpenAI text-embedding-3-small for vector embeddings
- Auto-curate: LLM-powered knowledge extraction from raw text
- 96.3% mean reciprocal rank on retrieval benchmarks (40 queries, 5 domains)
- 13 unit tests (storage + vector)

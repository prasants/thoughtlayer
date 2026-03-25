# ThoughtLayer Architecture

## Design Principles

1. **Local-first, cloud-optional.** Everything works offline. Cloud sync is a feature, not a requirement.
2. **Files are the source of truth.** Human-readable Markdown. Git-friendly. No opaque databases as primary storage.
3. **BYOLLM.** Users bring their own LLM for curate operations. We never lock them into our API.
4. **Retrieval is the hard part.** Storage is commodity. Ingestion is commodity. The retrieval pipeline is what separates useful memory from expensive grep.
5. **Knowledge has a lifecycle.** Facts age, conflict, get superseded. A memory system that ignores this is a liability.

## Components

### 1. Storage Layer

**SQLite** is the backing store. Three concerns in one file:

| Concern | Technology | Purpose |
|---------|-----------|---------|
| Metadata | SQLite tables | Entries, relations, events, conflicts |
| Full-text search | FTS5 virtual table | BM25 keyword ranking, porter stemming |
| Vector search | Float32Array blobs | Cosine similarity (brute-force Phase 0, HNSW Phase 1) |
| Embedding codec | Int8 scalar quantisation | ~4x compression with per-row codec tracking |

**Markdown files** are generated as a human-readable mirror. Each entry gets a `.md` file with YAML frontmatter in `.thoughtlayer/knowledge/<domain>/<topic>/`. These files are the canonical format for sharing, git, and debugging.

**Why not pgvector?** pgvector is great for cloud mode (Phase 2+). But for local-first, SQLite is zero-config, single-file, and fast enough for <100K entries. sqlite-vss (HNSW) planned for Phase 1.

### 2. Ingest Engine (Curate)

Two paths for getting knowledge in:

**Manual (`thoughtlayer.add`):** Developer provides structured data directly. No LLM call. Fastest, cheapest, most precise.

**LLM-powered (`thoughtlayer.curate`):** Raw text goes to the configured LLM with a structured prompt. The LLM returns JSON operations (ADD/UPDATE/MERGE/DELETE), each with domain, title, content, facts, tags, keywords, importance, confidence. The curate prompt includes existing domains for dedup context.

Supported LLM providers:
- Anthropic (Claude): best quality
- OpenAI (GPT-4o-mini): cheapest
- OpenRouter: any model
- AWS Bedrock: Phase 2
- Local (Ollama): Phase 1

### 3. Retrieval Pipeline

The core differentiator. Five stages:

```
1. Vector Search
   Query embedding → cosine similarity against all entry embeddings
   Returns: top-3K candidates with similarity scores

2. Keyword Search (FTS5)
   Query terms → BM25 ranking across title, content, tags, keywords
   Returns: top-3K candidates with BM25 scores

3. Metadata Filter
   Apply domain, tag, importance filters
   Removes candidates that don't match constraints

4. Score Fusion
   weighted_score = vec × 0.35 + fts × 0.35 + freshness × 0.10 + importance × 0.20
   Each signal contributes independently (no RRF rank fusion in v0.1)

5. Top-K Selection
   Sort by combined score, return top K results
   Record access for freshness tracking
```

**Freshness decay:** Exponential with 30-day half-life. Knowledge from today scores 1.0. Knowledge from 30 days ago scores 0.5. Knowledge from 60 days ago scores 0.25. This naturally deprioritises stale entries without deleting them.

**Why not just vector search?** Vector search is semantic but fuzzy. It might return "database architecture" when you asked for "PostgreSQL version". FTS5 with BM25 catches exact keyword matches that vectors miss. The combination (vector + FTS) outperforms either alone. Our tests show 96.3% accuracy on 27 diverse queries.

### 4. Embedding Layer

Embeddings are generated for both entries and queries using OpenAI text-embedding-3-small (1536 dimensions, $0.02/1M tokens).

**Phase 0:** Brute-force cosine similarity. O(n) per query. At 10K entries with 1536-dim vectors, this takes ~5ms. Fast enough.

**Phase 1:** sqlite-vss with HNSW index. O(log n) per query. Required above ~50K entries.

**Phase 2:** pgvector in Supabase for cloud mode. Automatic indexing, no manual HNSW management.

### 5. Event Log

Append-only JSONL log of all operations (create, update, archive, access). Used for:
- Sync protocol (Phase 2): incremental replication
- Analytics: access patterns, knowledge gaps
- Audit trail: who changed what, when

## Data Flow

### Write Path
```
User text → LLM curate → CurateOperations[]
  → For each operation:
    → Write to SQLite (triggers update FTS5 index)
    → Generate embedding → Write to SQLite embeddings table
    → Write Markdown file to .thoughtlayer/knowledge/
    → Append to event log
```

### Read Path
```
User query → Generate query embedding
  → Vector search (cosine similarity)
  → FTS5 search (BM25)
  → Filter + Score + Rank
  → Return top-K results
  → Record access (update access_count, last_accessed_at)
```

## File Format

### Knowledge Entry (Markdown)

```markdown
---
id: 019ce0d7-fd11-7158-b2d7-913c150d8828
title: "JWT Refresh Token Strategy"
domain: authentication
topic: jwt
importance: 0.8
confidence: 0.9
tags: ["security", "auth"]
keywords: ["jwt", "refresh", "token"]
source_type: conversation
status: active
version: 1
created_at: 2026-03-12T07:00:00.000Z
updated_at: 2026-03-12T07:00:00.000Z
freshness_at: 2026-03-12T07:00:00.000Z
---

# JWT Refresh Token Strategy

Refresh tokens expire after 7 days. Use rotating refresh tokens for security.

## Facts

- Refresh token TTL is 7 days
- Rotating refresh tokens invalidate previous tokens on use
```

### Config (.thoughtlayer/config.json)

```json
{
  "version": 1,
  "embedding": {
    "provider": "openai"
  },
  "curate": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  }
}
```

## Infrastructure (Cloud Mode: Phase 2+)

| Layer | Service | Why |
|-------|---------|-----|
| Database | Supabase Postgres + pgvector | Built-in vector search, RLS for multi-tenancy |
| Auth | Supabase Auth | Social logins, JWT, simpler than Cognito |
| File Storage | Supabase Storage + S3 | Markdown backup + sync |
| API / Compute | AWS Lambda | Scales to zero, covered by AWS credits |
| LLM | AWS Bedrock | BYOLLM advantage for AWS users |
| CDN | AWS CloudFront | Docs, dashboard, API caching |
| Dashboard | Vercel (Next.js) | Free tier, seamless deploys |

## Performance

Benchmarks on Phase 0 (brute-force vector search, 24 entries):

| Operation | Time |
|-----------|------|
| Add entry (with embedding) | ~200ms (dominated by OpenAI API call) |
| Query (vector + FTS) | ~250ms (dominated by OpenAI embedding call) |
| Search (FTS only) | <5ms |
| List entries | <1ms |
| Health check | <1ms |

At 10K entries, vector search adds ~5ms (brute-force cosine). FTS5 stays <5ms regardless of corpus size. The bottleneck is always the embedding API call, not local computation.

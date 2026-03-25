# Benchmark Results

Last run: 2026-03-18

## Setup
- **Dataset:** 50 entries across 5 domains, 55 test queries with ground-truth labels
- **Queries:** 40 standard + 15 hard (semantic, synonyms, cross-domain reasoning)
- **Hardware:** Linux x64, 2 vCPU, 4GB RAM
- **Embedding model:** OpenAI text-embedding-3-small

## Results: v0.2.2 (stopword fix + harder benchmark)

| Metric | Full Pipeline | FTS-only | Delta |
|--------|--------------|----------|-------|
| Recall@1 | **78.2%** | 70.0% | +8.2% |
| Recall@3 | **88.2%** | 82.7% | +5.5% |
| Recall@5 | **90.9%** | 84.5% | +6.4% |
| Recall@10 | **92.7%** | 88.2% | +4.5% |
| MRR | **92.9%** | 86.7% | +6.2% |
| Latency p50 | 186ms | 4ms |: |
| Failures | 3/55 | 6/55 | -3 |

**Key insight:** Embeddings add +8.2% Recall@1 on queries requiring semantic understanding. The remaining 3 failures are genuinely hard cases where neither keywords nor embeddings capture the semantic relationship.

## Bug Fixed: Stopword-Induced RRF Corruption

Root cause: "any" was not a stopword. Queries like "Any lessons about cleaning up resources?" extracted the term "any", which matched 6 unrelated entries. These entries received a multi-list bonus in RRF fusion, pushing the correct answer (inc-005, Memory leak) from #1 to #7.

Fix: Added "any", "every", "best", "tell" to stopwords in both FTS and term matching.

## Remaining Failures

| Query | Expected | Got | Root Cause |
|-------|----------|-----|------------|
| "Who should I ask about Postgres performance?" | ppl-003, ppl-010 | ppl-009 | Hiring post has exact phrase "Postgres (performance tuning)" |
| "Any concerns about relying on external services?" | inc-010, arch-003 | arch-002 | "external services" ≠ "third-party auth" in embedding space |
| "Any issues with AI making mistakes?" | inc-003 | prod-003 | "mistakes" ≠ "hallucination" in embedding space |

These require:
- Entity type awareness (job posting vs team member)
- Synonym expansion or query rewriting
- Fine-tuned embeddings for domain-specific synonyms

## Historical Comparison

| Version | Recall@1 | Recall@3 | MRR | Benchmark |
|---------|----------|----------|-----|-----------|
| v0.1.0 | 80.0% | 93.8% | 96.3% | 40 queries (easy) |
| v0.2.0 | 81.3% | 92.5% | 96.5% | 40 queries (easy) |
| v0.2.2 | 78.2% | 88.2% | 92.9% | 55 queries (hard) |

Note: v0.2.2 numbers are on a harder benchmark. The 15 new queries specifically target semantic understanding gaps that v0.1.0/v0.2.0 couldn't test.

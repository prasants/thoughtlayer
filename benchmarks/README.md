# ThoughtLayer Retrieval Benchmarks

Public, reproducible benchmarks for ThoughtLayer's retrieval pipeline.

## Dataset

`dataset.json` contains 50 knowledge entries across 5 domains, plus 40 test queries with ground-truth relevant entry IDs.

Domains:
- **architecture**: Software architecture decisions
- **operations**: Infrastructure and deployment
- **product**: Product decisions and roadmap
- **people**: Team structure and preferences
- **incidents**: Past incidents and post-mortems

## Metrics

- **Recall@K**: What fraction of relevant entries appear in the top K results?
- **Precision@K**: What fraction of top K results are relevant?
- **MRR**: Mean Reciprocal Rank of the first relevant result.
- **Latency**: p50 and p95 retrieval time (ms).

## Running

```bash
# Full benchmark (requires OPENAI_API_KEY for embeddings)
npm run benchmark

# Keyword-only benchmark (no API key needed)
npm run benchmark:offline
```

## Results

See `RESULTS.md` for latest numbers.

#!/usr/bin/env tsx
/**
 * ThoughtLayer Retrieval Benchmark
 *
 * Loads the public dataset, indexes all entries, runs all queries,
 * and reports Recall@K, Precision@K, MRR, and latency.
 *
 * Usage:
 *   OPENAI_API_KEY=... tsx benchmarks/run.ts          # full (vector + FTS) on train set
 *   tsx benchmarks/run.ts --offline                    # FTS-only (no API key) on train set
 *   tsx benchmarks/run.ts --val                        # run on validation set (held-out)
 *   tsx benchmarks/run.ts --offline --val              # FTS-only on validation set
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ThoughtLayer } from '../src/thoughtlayer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Entry {
  id: string;
  domain: string;
  title: string;
  content: string;
}

interface Query {
  id: string;
  query: string;
  relevant: string[];
  domain_hint?: string;
}

interface Dataset {
  version: number;
  entries: Entry[];
  queries: Query[];
}

// --- Config ---
const K_VALUES = [1, 3, 5, 10];
const offline = process.argv.includes('--offline');
const verbose = process.argv.includes('--verbose');
const useVal = process.argv.includes('--val');

// --- Load dataset ---
// Train split (dataset.json) is for tuning. Validation split (dataset-val.json) is held-out.
// The validation set uses the same entries but different queries.
const datasetFile = useVal ? 'dataset-val.json' : 'dataset.json';
const dataset: Dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, datasetFile), 'utf-8')
);

console.log(`\n📊 ThoughtLayer Retrieval Benchmark`);
console.log(`   ${dataset.entries.length} entries, ${dataset.queries.length} queries`);
console.log(`   Mode: ${offline ? 'offline (FTS only)' : 'full (vector + FTS)'}`);
console.log(`   Split: ${useVal ? 'VALIDATION (held-out)' : 'TRAIN'}\n`);

// --- Setup ---
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thoughtlayer-bench-'));
// Prefer Ollama (local, free), fall back to OpenAI
const embeddingConfig = offline ? undefined : (
  process.env.OPENAI_API_KEY
    ? { provider: 'openai' as const, apiKey: process.env.OPENAI_API_KEY }
    : { provider: 'ollama' as const, model: 'nomic-embed-text' }
);
const thoughtlayer = ThoughtLayer.init(tmpDir, embeddingConfig ? { embedding: embeddingConfig } : undefined);

// Map from our dataset IDs to ThoughtLayer's generated UUIDs
const idMap = new Map<string, string>();

// --- Index ---
console.log('Indexing entries...');
const indexStart = performance.now();

for (const entry of dataset.entries) {
  const created = await thoughtlayer.add({
    domain: entry.domain,
    title: entry.title,
    content: entry.content,
    tags: [entry.id],  // Store original ID as tag for lookup
  });
  idMap.set(created.id, entry.id);
}

const indexTime = performance.now() - indexStart;
console.log(`Indexed ${dataset.entries.length} entries in ${(indexTime / 1000).toFixed(1)}s\n`);

// --- Query ---
interface QueryResult {
  queryId: string;
  expected: string[];
  retrieved: string[];  // dataset IDs in ranked order
  latencyMs: number;
}

const results: QueryResult[] = [];

console.log('Running queries...');
for (const q of dataset.queries) {
  const start = performance.now();

  let retrieved: string[];
  if (offline) {
    // FTS-only path
    const ftsResults = await thoughtlayer.search(q.query, 10);
    retrieved = ftsResults.map(r => idMap.get(r.entry.id) ?? r.entry.id);
  } else {
    // Full retrieval pipeline
    const fullResults = await thoughtlayer.query(q.query, { topK: 10 });
    retrieved = fullResults.map(r => idMap.get(r.entry.id) ?? r.entry.id);
  }

  const latencyMs = performance.now() - start;

  results.push({
    queryId: q.id,
    expected: q.relevant,
    retrieved,
    latencyMs,
  });

  if (verbose) {
    const hit = q.relevant.some(r => retrieved.slice(0, 3).includes(r));
    console.log(`  ${hit ? '✅' : '❌'} ${q.id}: "${q.query.slice(0, 50)}..." → [${retrieved.slice(0, 3).join(', ')}]`);
  }
}

// --- Compute metrics ---
function recallAtK(results: QueryResult[], k: number): number {
  let total = 0;
  for (const r of results) {
    const topK = new Set(r.retrieved.slice(0, k));
    const hits = r.expected.filter(e => topK.has(e)).length;
    total += hits / r.expected.length;
  }
  return total / results.length;
}

function precisionAtK(results: QueryResult[], k: number): number {
  let total = 0;
  for (const r of results) {
    const topK = r.retrieved.slice(0, k);
    const hits = topK.filter(e => r.expected.includes(e)).length;
    total += hits / k;
  }
  return total / results.length;
}

function mrr(results: QueryResult[]): number {
  let total = 0;
  for (const r of results) {
    const rank = r.retrieved.findIndex(e => r.expected.includes(e));
    if (rank >= 0) {
      total += 1 / (rank + 1);
    }
  }
  return total / results.length;
}

function latencyStats(results: QueryResult[]) {
  const sorted = results.map(r => r.latencyMs).sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

// --- Report ---
console.log('\n' + '='.repeat(55));
console.log('  RESULTS');
console.log('='.repeat(55));

console.log('\n  Recall@K (higher is better):');
for (const k of K_VALUES) {
  const score = recallAtK(results, k);
  console.log(`    Recall@${k.toString().padEnd(3)} ${(score * 100).toFixed(1)}%`);
}

console.log('\n  Precision@K (higher is better):');
for (const k of K_VALUES) {
  const score = precisionAtK(results, k);
  console.log(`    Precision@${k.toString().padEnd(3)} ${(score * 100).toFixed(1)}%`);
}

const mrrScore = mrr(results);
console.log(`\n  MRR:        ${(mrrScore * 100).toFixed(1)}%`);

const latency = latencyStats(results);
console.log(`\n  Latency:`);
console.log(`    p50:      ${latency.p50.toFixed(1)}ms`);
console.log(`    p95:      ${latency.p95.toFixed(1)}ms`);
console.log(`    mean:     ${latency.mean.toFixed(1)}ms`);

// --- Failures ---
const failures = results.filter(r => !r.expected.some(e => r.retrieved.slice(0, 3).includes(e)));
if (failures.length > 0) {
  console.log(`\n  ❌ Missed (not in top 3): ${failures.length}/${results.length}`);
  for (const f of failures) {
    const q = dataset.queries.find(q => q.id === f.queryId)!;
    console.log(`    ${f.queryId}: "${q.query.slice(0, 60)}": expected [${f.expected.join(', ')}], got [${f.retrieved.slice(0, 3).join(', ')}]`);
  }
}

console.log('\n' + '='.repeat(55));

// --- Write results file ---
const resultsData = {
  timestamp: new Date().toISOString(),
  mode: offline ? 'offline' : 'full',
  dataset: { entries: dataset.entries.length, queries: dataset.queries.length },
  metrics: {
    recall: Object.fromEntries(K_VALUES.map(k => [`@${k}`, recallAtK(results, k)])),
    precision: Object.fromEntries(K_VALUES.map(k => [`@${k}`, precisionAtK(results, k)])),
    mrr: mrrScore,
    latency: { p50: latency.p50, p95: latency.p95, mean: latency.mean },
  },
  failures: failures.map(f => ({
    queryId: f.queryId,
    query: dataset.queries.find(q => q.id === f.queryId)!.query,
    expected: f.expected,
    retrieved: f.retrieved.slice(0, 5),
  })),
};

fs.writeFileSync(
  path.join(__dirname, 'results.json'),
  JSON.stringify(resultsData, null, 2),
  'utf-8'
);

// --- Cleanup ---
thoughtlayer.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\nResults written to benchmarks/results.json`);
process.exit(failures.length > 0 && mrrScore < 0.8 ? 1 : 0);

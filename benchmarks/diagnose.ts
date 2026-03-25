#!/usr/bin/env tsx
/**
 * Diagnostic: shows FTS scores vs Vector scores for each query
 * 
 * Usage: OPENAI_API_KEY=... npx tsx benchmarks/diagnose.ts
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ThoughtLayer } from '../src/thoughtlayer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Entry { id: string; domain: string; title: string; content: string; }
interface Query { id: string; query: string; relevant: string[]; }
interface Dataset { entries: Entry[]; queries: Query[]; }

const dataset: Dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'dataset.json'), 'utf-8')
);

// Setup
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-diag-'));
const tl = ThoughtLayer.init(tmpDir, {
  embedding: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
});

const idMap = new Map<string, string>();
const reverseMap = new Map<string, string>();

console.log('Indexing...');
for (const entry of dataset.entries) {
  const created = await tl.add({
    domain: entry.domain,
    title: entry.title,
    content: entry.content,
    tags: [entry.id],
  });
  idMap.set(created.id, entry.id);
  reverseMap.set(entry.id, created.id);
}

console.log('\n=== DIAGNOSTIC: FTS vs Vector ===\n');

// Analyse the 4 failing queries from the harder benchmark
const targetQueries = ['q-004', 'q-048', 'q-051', 'q-055'];

for (const qid of targetQueries) {
  const q = dataset.queries.find(x => x.id === qid)!;
  console.log(`\n--- ${qid}: "${q.query}" ---`);
  console.log(`Expected: [${q.relevant.join(', ')}]`);
  
  // Get FTS-only results
  const ftsResults = tl.search(q.query, 10);
  console.log('\nFTS-only top 5:');
  for (const r of ftsResults.slice(0, 5)) {
    const datasetId = idMap.get(r.id)!;
    const isRelevant = q.relevant.includes(datasetId);
    console.log(`  ${isRelevant ? '✅' : '  '} ${datasetId}: score=${r.rank.toFixed(1)} "${r.title.slice(0, 40)}"`);
  }
  
  // Get full pipeline results
  const fullResults = await tl.query(q.query, { topK: 10 });
  console.log('\nFull pipeline top 5:');
  for (const r of fullResults.slice(0, 5)) {
    const datasetId = idMap.get(r.entry.id)!;
    const isRelevant = q.relevant.includes(datasetId);
    const s = r.sources;
    console.log(`  ${isRelevant ? '✅' : '  '} ${datasetId}: score=${r.score.toFixed(3)} [rrf=${s.rrf.toFixed(2)}, vec=${s.vector?.toFixed(2) ?? 'n/a'}, fts=${s.fts?.toFixed(2) ?? 'n/a'}] "${r.entry.title.slice(0, 30)}"`);
  }
  
  // Show where expected entries ranked
  console.log('\nExpected entries in full pipeline:');
  for (const relId of q.relevant) {
    const tlId = reverseMap.get(relId)!;
    const idx = fullResults.findIndex(r => r.entry.id === tlId);
    if (idx >= 0) {
      const r = fullResults[idx];
      console.log(`  ${relId}: rank #${idx + 1}, score=${r.score.toFixed(3)}`);
    } else {
      console.log(`  ${relId}: NOT IN TOP 10`);
    }
  }
}

// Cleanup
tl.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

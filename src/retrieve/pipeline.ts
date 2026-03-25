/**
 * Retrieval Pipeline
 *
 * The moat. Combines multiple search strategies:
 * 1. Vector search (semantic similarity via cosine)
 * 2. FTS5 search (BM25 keyword matching)
 * 3. Reciprocal Rank Fusion (combines ranked lists: the core algorithm)
 * 4. Metadata boosting (importance, freshness, tag overlap)
 * 5. Multi-list presence bonus (entries found by multiple strategies rank higher)
 * 6. Query intent detection (domain/freshness boosts based on query type)
 * 7. Temporal awareness (time-period matching from query references)
 * 8. Entity resolution (name/alias matching for people queries)
 */

import type { ThoughtLayerDatabase, KnowledgeEntry } from '../storage/database.js';
import { vectorSearch, type VectorResult } from './vector.js';
import { detectIntent, type IntentResult } from './intent.js';
import { parseTemporalRefs, temporalBoost, type TemporalParseResult } from './temporal.js';
import { resolveEntities, type EntityMatch } from './entity.js';
import { graphBoost } from './graph.js';

export interface RetrievalResult {
  entry: KnowledgeEntry;
  score: number;
  sources: {
    vector?: number;
    fts?: number;
    rrf: number;
    freshness: number;
    importance: number;
    intentBoost?: number;
    temporalBoost?: number;
    entityBoost?: number;
    graphBoost?: number;
  };
  intent?: IntentResult;
  temporalRefs?: TemporalParseResult;
  entityMatch?: EntityMatch;
}

export interface RetrievalOptions {
  query: string;
  queryEmbedding?: Float32Array;
  domain?: string;
  tags?: string[];
  topK?: number;
  freshnessHalfLifeDays?: number;
  weights?: {
    rrf?: number;
    freshness?: number;
    importance?: number;
    graph?: number;
  };
}

const DEFAULT_WEIGHTS = {
  rrf: 0.75,
  freshness: 0.05,
  importance: 0.20,
};

/**
 * Reciprocal Rank Fusion
 */
function reciprocalRankFusion(
  rankedLists: Map<string, number>[],
  k: number = 60
): Map<string, number> {
  const fused = new Map<string, number>();
  const listCount = new Map<string, number>();

  for (const list of rankedLists) {
    const sorted = [...list.entries()].sort((a, b) => b[1] - a[1]);

    for (let rank = 0; rank < sorted.length; rank++) {
      const [id] = sorted[rank];
      const current = fused.get(id) ?? 0;
      fused.set(id, current + 1 / (k + rank + 1));
      listCount.set(id, (listCount.get(id) ?? 0) + 1);
    }
  }

  if (rankedLists.length > 1) {
    for (const [id, count] of listCount.entries()) {
      if (count > 1) {
        const current = fused.get(id)!;
        const bonus = 1 + 0.2 * (count - 1);
        fused.set(id, current * bonus);
      }
    }
  }

  return fused;
}

function normalise(scores: Map<string, number>): Map<string, number> {
  if (scores.size === 0) return scores;

  let max = -Infinity;
  let min = Infinity;
  for (const v of scores.values()) {
    if (v > max) max = v;
    if (v < min) min = v;
  }

  const range = max - min;
  if (range === 0) {
    const normalised = new Map<string, number>();
    for (const [k] of scores) normalised.set(k, 1);
    return normalised;
  }

  const normalised = new Map<string, number>();
  for (const [k, v] of scores) {
    normalised.set(k, (v - min) / range);
  }
  return normalised;
}

function freshnessScore(freshnessAt: string, halfLifeDays: number = 30): number {
  const age = Date.now() - new Date(freshnessAt).getTime();
  const ageDays = age / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function extractQueryTerms(query: string): string[] {
  const stopwords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'any',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
    'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't',
    'just', 'don', 'now', 'about', 'what', 'which', 'who', 'whom', 'this',
    'that', 'these', 'those', 'am', 'but', 'if', 'or', 'because', 'until',
    'while', 'and', 'it', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
    'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'ask',
    'any', 'every', 'best', 'tell',
  ]);

  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

/**
 * Main retrieval pipeline.
 */
export function retrieve(
  db: ThoughtLayerDatabase,
  options: RetrievalOptions
): RetrievalResult[] {
  const topK = options.topK ?? 10;
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const halfLife = options.freshnessHalfLifeDays ?? 30;
  const candidatePool = Math.max(topK * 5, 50);

  // --- Intent Detection ---
  const intentResult = detectIntent(options.query);

  // --- Temporal Parsing ---
  const temporalResult = parseTemporalRefs(options.query);

  const rankedLists: Map<string, number>[] = [];
  const vectorScores = new Map<string, number>();
  const ftsScores = new Map<string, number>();

  // 1. Vector search
  const VECTOR_MIN_THRESHOLD = 0.35;
  
  if (options.queryEmbedding) {
    const allEmbeddings = db.getAllEmbeddings();
    const results = vectorSearch(options.queryEmbedding, allEmbeddings, candidatePool);

    for (const r of results) {
      if (r.score >= VECTOR_MIN_THRESHOLD) {
        vectorScores.set(r.entryId, r.score);
      }
    }
    if (vectorScores.size > 0) {
      rankedLists.push(vectorScores);
    }
  }

  // 2. FTS5 search (BM25)
  const ftsResults = db.searchFTS(options.query, candidatePool);
  
  let ftsDominant = false;
  if (ftsResults.length >= 2) {
    const top = -ftsResults[0].rank;
    const second = -ftsResults[1].rank;
    if (top > 0 && second > 0 && top / second >= 3) {
      ftsDominant = true;
    }
  }
  
  for (const r of ftsResults) {
    ftsScores.set(r.id, -r.rank);
  }
  if (ftsScores.size > 0) {
    rankedLists.push(ftsScores);
    if (ftsDominant) {
      rankedLists.push(new Map(ftsScores));
    }
  }

  // 3. Query term matching
  const queryTerms = extractQueryTerms(options.query);
  const termScores = new Map<string, number>();

  if (queryTerms.length > 0) {
    // Include all entries as candidates for term matching (prefix matching needs broad scan)
    let allCandidateIds = new Set([...vectorScores.keys(), ...ftsScores.keys()]);
    if (allCandidateIds.size < candidatePool) {
      const broadEntries = db.list({ limit: candidatePool });
      for (const e of broadEntries) allCandidateIds.add(e.id);
    }

    for (const id of allCandidateIds) {
      const entry = db.getById(id);
      if (!entry) continue;

      const searchText = (
        entry.title + ' ' + entry.content + ' ' +
        entry.tags.join(' ') + ' ' + entry.keywords.join(' ')
      ).toLowerCase();

      let matches = 0;
      const entryTerms = searchText.split(/\s+/).filter(w => w.length > 2);
      for (const term of queryTerms) {
        if (searchText.includes(term)) {
          matches++;
        } else {
          // Prefix matching: query term is prefix of entry term or vice versa
          const prefixMatch = entryTerms.some(
            et => (et.startsWith(term) || term.startsWith(et)) && et !== term
          );
          if (prefixMatch) matches += 0.7;
        }
      }

      if (matches > 0) {
        termScores.set(id, matches / queryTerms.length);
      }
    }

    if (termScores.size > 0) {
      rankedLists.push(termScores);
    }
  }

  // 4. Entity resolution: boost entries that match entity references
  const allEntries = db.list({ limit: 10000 });
  const entityMatches = resolveEntities(options.query, allEntries);
  const entityScores = new Map<string, number>();
  const entityMatchMap = new Map<string, EntityMatch>();

  if (entityMatches.length > 0) {
    for (const match of entityMatches) {
      entityScores.set(match.entryId, match.confidence);
      entityMatchMap.set(match.entryId, match);
    }
    rankedLists.push(entityScores);
  }

  // 5. Reciprocal Rank Fusion
  const rrfScores = rankedLists.length > 0
    ? normalise(reciprocalRankFusion(rankedLists))
    : new Map<string, number>();

  // 7. Graph boost: find entries connected to query entities via knowledge graph
  const graphScores = graphBoost(options.query, db);
  const graphWeight = weights.graph ?? 0.15;

  // Collect all candidate IDs
  const candidateIds = new Set<string>([
    ...vectorScores.keys(),
    ...ftsScores.keys(),
    ...entityScores.keys(),
    ...termScores.keys(),
    ...graphScores.keys(),
  ]);

  // 6. Score each candidate with weighted combination
  const results: RetrievalResult[] = [];

  // Adjust freshness weight based on intent
  const adjustedFreshnessWeight = weights.freshness! * intentResult.freshnessBoost;

  for (const id of candidateIds) {
    const entry = db.getById(id);
    if (!entry || entry.status !== 'active') continue;

    // Apply domain filter
    if (options.domain && entry.domain !== options.domain) continue;

    // Apply tag filter
    if (options.tags && options.tags.length > 0) {
      const hasTag = options.tags.some(t => entry.tags.includes(t));
      if (!hasTag) continue;
    }

    const fresh = freshnessScore(entry.freshness_at, halfLife);
    const rrf = rrfScores.get(id) ?? 0;

    // BM25 dominance: if this entry's FTS score is much higher than average,
    // give it a boost proportional to how dominant it is
    const ftsScore = ftsScores.get(id) ?? 0;
    let bm25Bonus = 0;
    if (ftsScore > 0 && ftsScores.size > 1) {
      const allFts = [...ftsScores.values()];
      const maxFts = Math.max(...allFts);
      if (maxFts > 0) {
        // Normalise this entry's FTS score relative to the max
        bm25Bonus = (ftsScore / maxFts) * 0.15; // up to 0.15 bonus
      }
    }

    // Intent-based domain boost
    let intentBoostVal = 1.0;
    const domainBoost = intentResult.domainBoosts[entry.domain];
    if (domainBoost) {
      intentBoostVal = domainBoost;
    }
    // Also check tags for domain boost matches
    for (const tag of entry.tags) {
      const tagBoost = intentResult.domainBoosts[tag];
      if (tagBoost && tagBoost > intentBoostVal) {
        intentBoostVal = tagBoost;
      }
    }

    // Temporal boost
    const tempBoost = temporalBoost(entry.freshness_at, temporalResult.refs);

    // Entity boost
    const entBoost = entityScores.has(id) ? 1.3 : 1.0;

    // Graph boost (additive, weighted)
    const graphBoostVal = graphScores.get(id) ?? 0;

    // Final score
    let score =
      rrf * weights.rrf! +
      fresh * adjustedFreshnessWeight +
      entry.importance * weights.importance! +
      bm25Bonus +
      graphBoostVal * graphWeight;

    // Apply multiplicative boosts
    score *= intentBoostVal * tempBoost * entBoost;

    results.push({
      entry,
      score,
      sources: {
        vector: vectorScores.get(id),
        fts: ftsScores.get(id),
        rrf,
        freshness: fresh,
        importance: entry.importance,
        intentBoost: intentBoostVal,
        temporalBoost: tempBoost,
        entityBoost: entBoost,
        graphBoost: graphBoostVal,
      },
      intent: intentResult,
      temporalRefs: temporalResult,
      entityMatch: entityMatchMap.get(id),
    });

    db.recordAccess(id);
  }

  // Normalise scores to [0, 1] by dividing by max score
  const maxScore = results.reduce((mx, r) => Math.max(mx, r.score), 0);
  if (maxScore > 0) {
    for (const r of results) {
      r.score = r.score / maxScore;
    }
  }

  // Sort: if intent says recency, tie-break by freshness
  if (intentResult.recencySort || temporalResult.preferRecent) {
    results.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      // If scores are close (within 20%), prefer newer
      if (Math.abs(scoreDiff) < 0.2 * Math.max(a.score, b.score)) {
        return new Date(b.entry.freshness_at).getTime() - new Date(a.entry.freshness_at).getTime();
      }
      return scoreDiff;
    });
  } else {
    results.sort((a, b) => b.score - a.score);
  }

  return results.slice(0, topK);
}

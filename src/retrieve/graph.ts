/**
 * Graph-Enhanced Retrieval
 *
 * Boosts retrieval scores for entries connected to query entities via the knowledge graph.
 * If no relationships exist, this is a no-op with zero overhead.
 */

import type { ThoughtLayerDatabase } from '../storage/database.js';

/**
 * Extract potential entity names from a query string.
 * Looks for capitalised words and multi-word proper nouns.
 */
export function extractQueryEntities(query: string): string[] {
  const entities: string[] = [];

  // Multi-word proper nouns (e.g. "John Smith", "Acme Corp")
  const multiWord = query.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\b/g);
  if (multiWord) {
    for (const m of multiWord) {
      entities.push(m);
    }
  }

  // Single capitalised words (not at sentence start, not common words)
  const skipWords = new Set([
    'I', 'The', 'A', 'An', 'This', 'That', 'What', 'Who', 'Where',
    'When', 'How', 'Why', 'Which', 'My', 'Our', 'Your', 'His', 'Her',
    'Their', 'Its', 'Is', 'Are', 'Was', 'Were', 'Do', 'Does', 'Did',
    'Has', 'Have', 'Had', 'Will', 'Would', 'Could', 'Should', 'May',
    'Can', 'Tell', 'Find', 'Show', 'Get', 'Give', 'Let', 'If', 'But',
    'And', 'Or', 'Not', 'So', 'Yet', 'For', 'With', 'About',
  ]);

  const words = query.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^A-Za-z]/g, '');
    if (word.length >= 2 && /^[A-Z][a-z]+$/.test(word) && !skipWords.has(word)) {
      // Check it's not already part of a multi-word entity
      const alreadyCovered = entities.some(e =>
        e.toLowerCase().includes(word.toLowerCase())
      );
      if (!alreadyCovered) {
        entities.push(word);
      }
    }
  }

  return entities;
}

/**
 * Compute graph boost scores for entries related to entities mentioned in a query.
 *
 * Returns a map of entryId to boost score (0 to 1).
 * If no entities are found or no relationships exist, returns an empty map (zero cost).
 *
 * @param query - The search query.
 * @param db - The ThoughtLayer database instance.
 * @param maxHops - Maximum hops for graph traversal (default 2).
 * @returns Map of entry IDs to boost scores.
 */
export function graphBoost(
  query: string,
  db: ThoughtLayerDatabase,
  maxHops: number = 2,
): Map<string, number> {
  const entities = extractQueryEntities(query);
  if (entities.length === 0) return new Map();

  const combined = new Map<string, number>();

  for (const entity of entities) {
    const reachable = db.traverseGraph(entity, maxHops);
    for (const [entryId, score] of reachable) {
      const existing = combined.get(entryId) ?? 0;
      if (score > existing) {
        combined.set(entryId, score);
      }
    }
  }

  // Normalise to [0, 1]
  if (combined.size === 0) return combined;

  let max = 0;
  for (const v of combined.values()) {
    if (v > max) max = v;
  }
  if (max > 0 && max !== 1) {
    for (const [k, v] of combined) {
      combined.set(k, v / max);
    }
  }

  return combined;
}

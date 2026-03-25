/**
 * Entity Resolution
 *
 * Matches partial names, aliases, and fuzzy matches for people/entity queries.
 * "John" should find "John Smith: backend engineer".
 */

import type { KnowledgeEntry } from '../storage/database.js';

export interface EntityMatch {
  entryId: string;
  matchType: 'exact' | 'first_name' | 'alias' | 'fuzzy';
  confidence: number;
}

/**
 * Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const matrix: number[][] = [];
  for (let i = 0; i <= la; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lb; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[la][lb];
}

/**
 * Extract person names from entry title and content.
 * Returns array of {full, first, last} name parts.
 */
function extractNames(entry: KnowledgeEntry): Array<{ full: string; first: string; last: string }> {
  const names: Array<{ full: string; first: string; last: string }> = [];

  // Only extract names from entries that are explicitly about people
  const isPeopleEntry = entry.domain === 'team' || entry.domain === 'people' ||
    entry.tags.some(t => ['people', 'team', 'person', 'leadership', 'staff'].includes(t));

  // Extract names from title (common pattern: "Name: role" or "Name - role")
  const titleMatch = entry.title.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
  if (titleMatch) {
    const parts = titleMatch[1].split(/\s+/);
    names.push({
      full: titleMatch[1].toLowerCase(),
      first: parts[0].toLowerCase(),
      last: parts[parts.length - 1].toLowerCase(),
    });
  }

  // Only extract names from content if this is a people-domain entry
  if (!isPeopleEntry) return names;

  // Also extract from structured attribution patterns in content
  const structuredPatterns = [
    /(?:Decided by|Author|Owner|Lead|Manager|Created by|Assigned to|Contact):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g,
    /^(?:##?\s+)?Team\b.*?:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gm,
  ];

  for (const pattern of structuredPatterns) {
    let m;
    while ((m = pattern.exec(entry.content)) !== null) {
      const parts = m[1].split(/\s+/);
      const name = {
        full: m[1].toLowerCase(),
        first: parts[0].toLowerCase(),
        last: parts[parts.length - 1].toLowerCase(),
      };
      if (!names.some(n => n.full === name.full)) {
        names.push(name);
      }
    }
  }

  // For people entries, also extract Capitalized Name patterns from content
  const notNames = new Set([
    'uses', 'runs', 'gets', 'sets', 'makes', 'takes', 'goes', 'does',
    'has', 'was', 'had', 'did', 'new', 'old', 'the', 'our', 'his',
    'her', 'its', 'not', 'but', 'for', 'all', 'can', 'will', 'may',
    'each', 'also', 'both', 'some', 'most', 'very', 'much', 'well',
    'just', 'even', 'only', 'then', 'than', 'more', 'less', 'last',
    'next', 'best', 'good', 'high', 'low', 'full', 'long', 'late',
    'early', 'first', 'second', 'third', 'current', 'recent',
  ]);
  const contentNamePattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g;
  let m;
  while ((m = contentNamePattern.exec(entry.content)) !== null) {
    const parts = m[1].split(/\s+/);
    const first = parts[0].toLowerCase();
    const last = parts[parts.length - 1].toLowerCase();
    if (notNames.has(first) || notNames.has(last)) continue;
    const name = {
      full: m[1].toLowerCase(),
      first,
      last,
    };
    if (!names.some(n => n.full === name.full)) {
      names.push(name);
    }
  }

  return names;
}

/**
 * Extract aliases from an entry.
 * Aliases can be stored in tags as "alias:X" or in keywords.
 */
export function extractAliases(entry: KnowledgeEntry): string[] {
  const aliases: string[] = [];

  // Tags with alias prefix
  for (const tag of entry.tags) {
    if (tag.startsWith('alias:')) {
      aliases.push(tag.slice(6).toLowerCase());
    }
  }

  // Keywords that look like short aliases (initials, nicknames)
  for (const kw of entry.keywords) {
    if (kw.length <= 3 && /^[a-z]+$/i.test(kw)) {
      aliases.push(kw.toLowerCase());
    }
  }

  return aliases;
}

/**
 * Resolve entity references in a query against a set of entries.
 * Returns entries that match entity references in the query.
 */
export function resolveEntities(
  query: string,
  entries: KnowledgeEntry[]
): EntityMatch[] {
  const matches: EntityMatch[] = [];
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

  for (const entry of entries) {
    if (entry.status !== 'active') continue;

    const names = extractNames(entry);
    const aliases = extractAliases(entry);

    // Exact full name match
    for (const name of names) {
      if (queryLower.includes(name.full)) {
        matches.push({ entryId: entry.id, matchType: 'exact', confidence: 1.0 });
        continue;
      }

      // First name match (require length >= 4 and not a common English word)
      const commonWords = new Set([
        'new', 'long', 'take', 'make', 'will', 'just', 'back', 'over',
        'more', 'last', 'most', 'much', 'next', 'well', 'good', 'high',
        'real', 'best', 'work', 'main', 'open', 'full', 'post', 'test',
        'data', 'code', 'file', 'line', 'part', 'case', 'team', 'plan',
        'mark', 'type', 'name', 'time', 'date', 'link', 'list', 'note',
      ]);
      for (const word of queryWords) {
        if (word === name.first && word.length >= 4 && !commonWords.has(word)) {
          matches.push({ entryId: entry.id, matchType: 'first_name', confidence: 0.8 });
        }
      }

      // Fuzzy match on first or last name (Levenshtein ≤ 1 for names ≥ 4 chars)
      for (const word of queryWords) {
        if (word.length < 4 || commonWords.has(word)) continue;
        const maxDist = 1; // strict: only 1 edit allowed
        if (name.first.length >= 4 && levenshtein(word, name.first) <= maxDist && word !== name.first) {
          matches.push({ entryId: entry.id, matchType: 'fuzzy', confidence: 0.6 });
        }
        if (name.last.length >= 4 && levenshtein(word, name.last) <= maxDist && word !== name.last) {
          matches.push({ entryId: entry.id, matchType: 'fuzzy', confidence: 0.6 });
        }
      }
    }

    // Alias match
    for (const alias of aliases) {
      for (const word of queryWords) {
        if (word === alias) {
          matches.push({ entryId: entry.id, matchType: 'alias', confidence: 0.85 });
        }
      }
    }
  }

  // Deduplicate: keep highest confidence per entry
  const best = new Map<string, EntityMatch>();
  for (const match of matches) {
    const existing = best.get(match.entryId);
    if (!existing || match.confidence > existing.confidence) {
      best.set(match.entryId, match);
    }
  }

  return [...best.values()];
}

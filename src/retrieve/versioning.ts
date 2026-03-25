/**
 * Fact Versioning & Contradiction Detection
 *
 * Detects when a new entry contradicts an existing one on the same topic.
 * Stores supersedes relations and flags conflicts on retrieval.
 */

import type { ThoughtLayerDatabase, KnowledgeEntry, CreateEntryInput, Relation } from '../storage/database.js';

export interface ConflictInfo {
  currentEntry: KnowledgeEntry;
  supersededEntries: KnowledgeEntry[];
  hasConflicts: boolean;
}

export interface ContradictionCheck {
  hasContradiction: boolean;
  existingEntry: KnowledgeEntry | null;
  similarity: number;
  reason: string;
}

/**
 * Check if a new entry potentially contradicts an existing one.
 * Uses topic + title similarity to find candidates, then checks for factual overlap.
 */
export function checkContradiction(
  db: ThoughtLayerDatabase,
  newEntry: CreateEntryInput
): ContradictionCheck {
  // Find entries with same domain+topic
  const candidates = db.list({
    domain: newEntry.domain,
    topic: newEntry.topic,
    status: 'active',
    limit: 50,
  });

  if (candidates.length === 0) {
    return { hasContradiction: false, existingEntry: null, similarity: 0, reason: 'no candidates' };
  }

  const newTitleNorm = normalise(newEntry.title);
  const newFactSet = new Set((newEntry.facts ?? []).map(f => normalise(f)));

  for (const candidate of candidates) {
    // Title similarity
    const candTitleNorm = normalise(candidate.title);
    const titleSim = jaccardSimilarity(
      new Set(newTitleNorm.split(/\s+/)),
      new Set(candTitleNorm.split(/\s+/))
    );

    if (titleSim < 0.3) continue;

    // Check for contradicting facts
    const candFactSet = new Set(candidate.facts.map(f => normalise(f)));

    // Same topic, similar title, different facts = potential contradiction
    if (newFactSet.size > 0 && candFactSet.size > 0) {
      const factOverlap = jaccardSimilarity(newFactSet, candFactSet);
      if (factOverlap < 0.5 && titleSim > 0.5) {
        return {
          hasContradiction: true,
          existingEntry: candidate,
          similarity: titleSim,
          reason: `Same topic "${candidate.title}" but different facts (similarity: ${factOverlap.toFixed(2)})`,
        };
      }
    }

    // Content overlap check for entries without structured facts
    if (titleSim > 0.6) {
      const contentSim = jaccardSimilarity(
        new Set(normalise(newEntry.content).split(/\s+/)),
        new Set(normalise(candidate.content).split(/\s+/))
      );
      // High title similarity + moderate content difference = potential update
      if (contentSim < 0.5 && contentSim > 0.1) {
        return {
          hasContradiction: true,
          existingEntry: candidate,
          similarity: titleSim,
          reason: `Similar title but different content (content sim: ${contentSim.toFixed(2)})`,
        };
      }
    }
  }

  return { hasContradiction: false, existingEntry: null, similarity: 0, reason: 'no contradictions found' };
}

/**
 * Add an entry with contradiction awareness.
 * If a contradiction is found, creates a supersedes relation instead of silently overwriting.
 */
export function addWithVersioning(
  db: ThoughtLayerDatabase,
  input: CreateEntryInput
): { entry: KnowledgeEntry; superseded: KnowledgeEntry | null; isContradiction: boolean } {
  const check = checkContradiction(db, input);

  if (check.hasContradiction && check.existingEntry) {
    // Add supersedes relation to the new entry
    const relations: Relation[] = [
      ...(input.relations ?? []),
      {
        target_id: check.existingEntry.id,
        type: 'supersedes',
        strength: check.similarity,
      },
    ];

    const entry = db.create({
      ...input,
      relations,
      tags: [...(input.tags ?? []), 'has_prior_version'],
    });

    // Update the old entry to note it's been superseded
    const oldRelations: Relation[] = [
      ...check.existingEntry.relations,
      {
        target_id: entry.id,
        type: 'superseded_by',
        strength: check.similarity,
      },
    ];
    db.update(check.existingEntry.id, {
      relations: oldRelations,
      tags: [...check.existingEntry.tags, 'superseded'],
    });

    return { entry, superseded: check.existingEntry, isContradiction: true };
  }

  const entry = db.create(input);
  return { entry, superseded: null, isContradiction: false };
}

/**
 * Get conflict info for a retrieval result.
 * Checks if the entry has superseded entries and returns them.
 */
export function getConflictInfo(
  db: ThoughtLayerDatabase,
  entry: KnowledgeEntry
): ConflictInfo {
  const supersededEntries: KnowledgeEntry[] = [];

  for (const rel of entry.relations) {
    if (rel.type === 'supersedes') {
      const old = db.getById(rel.target_id);
      if (old) supersededEntries.push(old);
    }
  }

  return {
    currentEntry: entry,
    supersededEntries,
    hasConflicts: supersededEntries.length > 0,
  };
}

/**
 * List all entries with contradictions/conflicts.
 */
export function listConflicts(
  db: ThoughtLayerDatabase
): Array<{ current: KnowledgeEntry; previous: KnowledgeEntry }> {
  const entries = db.list({ limit: 10000 });
  const conflicts: Array<{ current: KnowledgeEntry; previous: KnowledgeEntry }> = [];

  for (const entry of entries) {
    for (const rel of entry.relations) {
      if (rel.type === 'supersedes') {
        const prev = db.getById(rel.target_id);
        if (prev) {
          conflicts.push({ current: entry, previous: prev });
        }
      }
    }
  }

  return conflicts;
}

// --- Helpers ---

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

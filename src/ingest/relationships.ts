/**
 * Relationship Extraction
 *
 * Extracts entity relationships from content at ingest time using NLP heuristics.
 * No LLM required. Stores as triples: (subject, predicate, object) with confidence scores.
 */

export interface Relationship {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

interface ExtractionPattern {
  regex: RegExp;
  predicate: string;
  confidence: number;
  /** If true, the predicate is captured from a regex group rather than fixed. */
  dynamicPredicate?: boolean;
}

/**
 * Normalise an entity name: trim, collapse whitespace, title-case.
 */
function normaliseEntity(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,:;!?]+$/, '')
    // Strip trailing noise phrases
    .replace(/\s+(?:last|next|in|on|at|from|since|during|after|before|for|with|about)\s+.*$/i, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .trim();
}

/**
 * Check whether an entity string is plausible (not empty, not just stopwords).
 */
function isValidEntity(entity: string): boolean {
  if (entity.length < 2 || entity.length > 80) return false;
  const stopOnly = new Set([
    'the', 'a', 'an', 'this', 'that', 'it', 'they', 'we', 'he', 'she',
    'i', 'you', 'who', 'which', 'what', 'where', 'when', 'how', 'why',
    'there', 'here', 'also', 'very', 'just', 'only', 'some', 'all',
  ]);
  const words = entity.toLowerCase().split(/\s+/);
  return !words.every(w => stopOnly.has(w));
}

// ── Extraction patterns ──

const PATTERNS: ExtractionPattern[] = [
  // "X is the Y of Z"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+is\s+the\s+([a-zA-Z\s]+?)\s+of\s+([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: '',
    confidence: 0.85,
    dynamicPredicate: true,
  },
  // "X is a/an Y" (role assignment)
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+is\s+(?:a|an)\s+([a-zA-Z][a-zA-Z\s]{2,30}?)(?:\.|,|;|\s+(?:who|that|and|at|in|for|with))/g,
    predicate: 'is_a',
    confidence: 0.75,
  },
  // "X works at Z"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+works?\s+(?:at|for)\s+([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'works_at',
    confidence: 0.85,
  },
  // "X reports to Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+reports?\s+to\s+([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'reports_to',
    confidence: 0.9,
  },
  // "X decided Y" / "X decided to Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+decided\s+(?:to\s+)?(.{3,50}?)(?:\.|,|;|$)/gm,
    predicate: 'decided',
    confidence: 0.8,
  },
  // "X uses Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)\s+uses?\s+([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'uses',
    confidence: 0.7,
  },
  // "X manages Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+manages?\s+([A-Z]?[A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'manages',
    confidence: 0.8,
  },
  // "X owns Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+owns?\s+([A-Z]?[A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'owns',
    confidence: 0.8,
  },
  // "X depends on Y"
  {
    regex: /\b([A-Z]?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+depends?\s+on\s+([A-Z]?[A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'depends_on',
    confidence: 0.75,
  },
  // "X leads Y" / "X led Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(?:leads?|led)\s+([A-Z]?[A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'leads',
    confidence: 0.8,
  },
  // "X created Y" / "X built Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(?:created|built|developed)\s+([A-Z]?[A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'created',
    confidence: 0.75,
  },
  // "X joined Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+joined\s+([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'joined',
    confidence: 0.8,
  },
  // "X replaced Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+replaced\s+([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'replaced',
    confidence: 0.8,
  },
  // "X acquired Y" / "X bought Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(?:acquired|bought|purchased)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)/g,
    predicate: 'acquired',
    confidence: 0.85,
  },
  // "X partnered with Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)\s+partnered\s+with\s+([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)/g,
    predicate: 'partnered_with',
    confidence: 0.8,
  },
  // "X approved Y"
  {
    regex: /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+approved\s+(.{3,40}?)(?:\.|,|;|$)/gm,
    predicate: 'approved',
    confidence: 0.8,
  },
];

/**
 * Extract title-based relationships.
 * Titles like "Meeting with Alice" or "Project Alpha Status" yield lightweight relations.
 */
function extractFromTitle(title: string): Relationship[] {
  const results: Relationship[] = [];

  // "Meeting with X" / "Call with X"
  const meetingMatch = title.match(/(?:meeting|call|sync|chat)\s+with\s+(.+)/i);
  if (meetingMatch) {
    const entity = normaliseEntity(meetingMatch[1]);
    if (isValidEntity(entity)) {
      results.push({
        subject: entity,
        predicate: 'mentioned_in',
        object: title,
        confidence: 0.6,
      });
    }
  }

  return results;
}

/**
 * Deduplicate relationships: same (subject, predicate, object) keeps highest confidence.
 */
function dedup(rels: Relationship[]): Relationship[] {
  const map = new Map<string, Relationship>();
  for (const rel of rels) {
    const key = `${rel.subject.toLowerCase()}|${rel.predicate}|${rel.object.toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || rel.confidence > existing.confidence) {
      map.set(key, rel);
    }
  }
  return [...map.values()];
}

/**
 * Extract entity relationships from content using NLP heuristics.
 *
 * @param content - The text content to extract relationships from.
 * @param title - The entry title (used for additional extraction).
 * @returns An array of relationship triples with confidence scores.
 */
export function extractRelationships(content: string, title: string): Relationship[] {
  const results: Relationship[] = [];
  const text = `${title}. ${content}`;

  for (const pattern of PATTERNS) {
    // Reset regex state
    pattern.regex.lastIndex = 0;
    let match;

    while ((match = pattern.regex.exec(text)) !== null) {
      if (pattern.dynamicPredicate) {
        // "X is the Y of Z" pattern: group 1=subject, 2=predicate, 3=object
        const subject = normaliseEntity(match[1]);
        const predicate = normaliseEntity(match[2]).toLowerCase().replace(/\s+/g, '_');
        const object = normaliseEntity(match[3]);

        if (isValidEntity(subject) && isValidEntity(object) && predicate.length > 1) {
          results.push({
            subject,
            predicate,
            object,
            confidence: pattern.confidence,
          });
        }
      } else {
        const subject = normaliseEntity(match[1]);
        const object = normaliseEntity(match[2]);

        if (isValidEntity(subject) && isValidEntity(object)) {
          results.push({
            subject,
            predicate: pattern.predicate,
            object,
            confidence: pattern.confidence,
          });
        }
      }
    }
  }

  // Title-based extraction
  results.push(...extractFromTitle(title));

  return dedup(results);
}

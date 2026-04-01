/**
 * Query Intent Detection
 *
 * Lightweight heuristic-based intent classification for queries.
 * No LLM calls: pure regex/keyword matching.
 * Used by the retrieval pipeline to apply domain and freshness boosts.
 */

export type QueryIntent =
  | 'who'        // People/team queries
  | 'when'       // Temporal queries
  | 'what_happened' // Incident/event queries
  | 'how'        // Process/procedure queries
  | 'decision'   // Decision queries
  | 'latest'     // Recency-focused queries
  | 'fact'       // Factual lookup
  | 'general';   // Default

export interface IntentResult {
  intent: QueryIntent;
  confidence: number;
  secondaryIntent?: QueryIntent;         // secondary intent for compound queries
  domainBoosts: Record<string, number>;  // domain -> multiplier
  freshnessBoost: number;                // multiplier for freshness weight
  recencySort: boolean;                  // whether to sort by recency
}

const PATTERNS: Array<{ pattern: RegExp; intent: QueryIntent; confidence: number }> = [
  // Who queries: people, team, roles
  { pattern: /^who\b/i, intent: 'who', confidence: 0.95 },
  { pattern: /\bwho (is|was|are|were)\b/i, intent: 'who', confidence: 0.9 },
  { pattern: /\b(team|person|people|engineer|manager|lead|director|vp|ceo|cto|cfo)\b/i, intent: 'who', confidence: 0.6 },
  { pattern: /\b(responsible for|in charge of|owns|manages)\b/i, intent: 'who', confidence: 0.7 },

  // When queries: dates, times, schedules
  { pattern: /^when\b/i, intent: 'when', confidence: 0.95 },
  { pattern: /\bwhen (did|does|will|was|is|are)\b/i, intent: 'when', confidence: 0.9 },
  { pattern: /\b(deadline|due date|schedule|timeline|eta|shipped|released|launched)\b/i, intent: 'when', confidence: 0.7 },

  // What happened: incidents, events, changes
  { pattern: /\bwhat happened\b/i, intent: 'what_happened', confidence: 0.95 },
  { pattern: /\b(incident|outage|issue|bug|problem|failure|crash|error|broke|broken)\b/i, intent: 'what_happened', confidence: 0.7 },
  { pattern: /\bwhat went wrong\b/i, intent: 'what_happened', confidence: 0.9 },
  { pattern: /\bwhat changed\b/i, intent: 'what_happened', confidence: 0.8 },

  // How: process, procedures
  { pattern: /^how (do|does|did|can|should|to)\b/i, intent: 'how', confidence: 0.9 },
  { pattern: /\b(process|procedure|steps|guide|howto|how-to|workflow|runbook)\b/i, intent: 'how', confidence: 0.7 },
  { pattern: /\bhow (do we|does the|do i)\b/i, intent: 'how', confidence: 0.85 },

  // Decision queries
  { pattern: /\bwhat did we decide\b/i, intent: 'decision', confidence: 0.95 },
  { pattern: /\b(decided|decision|chose|chosen|agreed|consensus|verdict)\b/i, intent: 'decision', confidence: 0.8 },
  { pattern: /\bwhy did we (choose|pick|go with|select|use)\b/i, intent: 'decision', confidence: 0.85 },

  // Latest/recency
  { pattern: /\b(latest|most recent|current|newest|last update|up to date|status)\b/i, intent: 'latest', confidence: 0.85 },
  { pattern: /\bwhat('s| is) the (latest|current|status)\b/i, intent: 'latest', confidence: 0.9 },
];

const DOMAIN_BOOSTS: Record<QueryIntent, Record<string, number>> = {
  who: { team: 1.5, people: 1.5 },
  when: {},
  what_happened: { incidents: 1.3 },
  how: {},
  decision: { decisions: 1.3 },
  latest: {},
  fact: {},
  general: {},
};

const FRESHNESS_BOOSTS: Record<QueryIntent, number> = {
  who: 1.0,
  when: 2.0,
  what_happened: 2.5,
  how: 0.8,
  decision: 2.0,
  latest: 4.0,
  fact: 0.5,
  general: 1.0,
};

const RECENCY_SORT: Set<QueryIntent> = new Set(['when', 'what_happened', 'decision', 'latest']);

/**
 * Detect query intent from natural language.
 * Supports multi-intent detection for compound queries like "latest decision on auth".
 * Returns highest-confidence match with optional secondary intent.
 */
export function detectIntent(query: string): IntentResult {
  // Collect all matching intents with their best confidence
  const matches = new Map<QueryIntent, number>();

  for (const { pattern, intent, confidence } of PATTERNS) {
    if (pattern.test(query)) {
      const existing = matches.get(intent) ?? 0;
      if (confidence > existing) {
        matches.set(intent, confidence);
      }
    }
  }

  // Check for negation: suppress freshness boost if query negates recency
  const hasNegation = /\b(not\s+recent|not\s+latest|older|earliest|oldest|first|original)\b/i.test(query);

  if (matches.size === 0) {
    return {
      intent: 'general',
      confidence: 0,
      domainBoosts: {},
      freshnessBoost: hasNegation ? 0.3 : 1.0,
      recencySort: false,
    };
  }

  // Sort intents by confidence, pick top 2
  const sorted = [...matches.entries()].sort((a, b) => b[1] - a[1]);
  const [primaryIntent, primaryConfidence] = sorted[0];

  let secondaryIntent: QueryIntent | undefined;
  let combinedDomainBoosts: Record<string, number> = { ...(DOMAIN_BOOSTS[primaryIntent] ?? {}) };
  let combinedFreshnessBoost = FRESHNESS_BOOSTS[primaryIntent] ?? 1.0;
  let combinedRecencySort = RECENCY_SORT.has(primaryIntent);

  // Multi-intent: if second intent has confidence >= 0.5 and is different
  if (sorted.length >= 2 && sorted[1][1] >= 0.5) {
    const [secIntent, secConfidence] = sorted[1];
    secondaryIntent = secIntent;

    // Merge domain boosts from both intents
    const secBoosts = DOMAIN_BOOSTS[secIntent] ?? {};
    for (const [domain, boost] of Object.entries(secBoosts)) {
      combinedDomainBoosts[domain] = Math.max(combinedDomainBoosts[domain] ?? 1, boost);
    }

    // Combine freshness boosts: use max, capped at primary * 1.5
    const secFreshnessBoost = FRESHNESS_BOOSTS[secIntent] ?? 1.0;
    combinedFreshnessBoost = Math.min(
      Math.max(combinedFreshnessBoost, secFreshnessBoost),
      combinedFreshnessBoost * 1.5
    );

    // Recency sort if either intent wants it
    combinedRecencySort = combinedRecencySort || RECENCY_SORT.has(secIntent);
  }

  // Apply negation override
  if (hasNegation) {
    combinedFreshnessBoost = Math.min(combinedFreshnessBoost, 0.3);
    combinedRecencySort = false;
  }

  return {
    intent: primaryIntent,
    confidence: primaryConfidence,
    secondaryIntent,
    domainBoosts: combinedDomainBoosts,
    freshnessBoost: combinedFreshnessBoost,
    recencySort: combinedRecencySort,
  };
}

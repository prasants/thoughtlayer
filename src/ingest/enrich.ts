/**
 * Ingest-time keyword enrichment (General Purpose)
 *
 * Extracts search-relevant keywords from content at write time.
 * Replaces the hardcoded concept bridges with a general-purpose approach:
 * - Capitalised noun phrases (proper nouns)
 * - Role/title patterns ("X is a Y", "X: Y")
 * - Action verbs with their objects
 * - Lightweight synonym expansion (WordNet-style clusters)
 * - Optional domain-specific plugin bridges
 */

// ── Lightweight synonym clusters (WordNet-style) ──
// Each key maps to its top 3 most common synonyms
const SYNONYM_CLUSTERS: Record<string, string[]> = {
  // Actions
  create: ['build', 'make', 'develop'],
  build: ['create', 'construct', 'develop'],
  fix: ['repair', 'resolve', 'patch'],
  deploy: ['release', 'ship', 'launch'],
  delete: ['remove', 'erase', 'drop'],
  update: ['modify', 'change', 'revise'],
  migrate: ['move', 'transfer', 'port'],
  monitor: ['track', 'watch', 'observe'],
  configure: ['setup', 'set up', 'config'],
  install: ['setup', 'set up', 'add'],
  debug: ['troubleshoot', 'diagnose', 'investigate'],
  test: ['verify', 'validate', 'check'],
  review: ['examine', 'assess', 'evaluate'],
  analyse: ['examine', 'study', 'investigate'],
  analyze: ['examine', 'study', 'investigate'],
  optimize: ['improve', 'enhance', 'speed up'],
  optimise: ['improve', 'enhance', 'speed up'],
  implement: ['build', 'develop', 'code'],
  refactor: ['restructure', 'rewrite', 'reorganise'],
  // Nouns
  database: ['db', 'datastore', 'storage'],
  server: ['backend', 'service', 'host'],
  client: ['frontend', 'user interface', 'ui'],
  api: ['endpoint', 'interface', 'service'],
  error: ['bug', 'issue', 'problem'],
  bug: ['error', 'defect', 'issue'],
  issue: ['problem', 'bug', 'error'],
  feature: ['functionality', 'capability', 'ability'],
  performance: ['speed', 'efficiency', 'throughput'],
  security: ['protection', 'safety', 'auth'],
  authentication: ['auth', 'login', 'sign in'],
  authorization: ['permissions', 'access control', 'rbac'],
  documentation: ['docs', 'guide', 'manual'],
  architecture: ['design', 'structure', 'system design'],
  meeting: ['discussion', 'sync', 'standup'],
  decision: ['choice', 'determination', 'resolution'],
  strategy: ['plan', 'approach', 'roadmap'],
  team: ['group', 'squad', 'crew'],
  project: ['initiative', 'workstream', 'program'],
  deadline: ['due date', 'target date', 'milestone'],
  budget: ['funding', 'allocation', 'spend'],
  revenue: ['income', 'earnings', 'sales'],
  cost: ['expense', 'spend', 'price'],
  risk: ['threat', 'vulnerability', 'exposure'],
  compliance: ['regulation', 'regulatory', 'governance'],
  contract: ['agreement', 'deal', 'arrangement'],
  // Roles
  engineer: ['developer', 'dev', 'programmer'],
  developer: ['engineer', 'dev', 'coder'],
  designer: ['ui designer', 'ux designer', 'creative'],
  manager: ['lead', 'head', 'director'],
  analyst: ['researcher', 'investigator', 'specialist'],
  ceo: ['chief executive', 'founder', 'head'],
  cto: ['tech lead', 'chief technology', 'technical director'],
  cfo: ['chief financial', 'finance head', 'treasurer'],
};

// ── Domain-specific plugin bridges (optional) ──
export interface ConceptBridge {
  trigger: RegExp;
  bridges: string[];
  suppress?: string[];
}

// Default empty: users can register domain plugins
let domainBridges: ConceptBridge[] = [];

/**
 * Register domain-specific concept bridges as a plugin.
 * These are additive to the general-purpose extraction.
 */
export function registerConceptBridges(bridges: ConceptBridge[]): void {
  domainBridges = [...domainBridges, ...bridges];
}

/**
 * Clear all registered domain bridges.
 */
export function clearConceptBridges(): void {
  domainBridges = [];
}

/**
 * Get currently registered bridges (for testing).
 */
export function getRegisteredBridges(): ConceptBridge[] {
  return [...domainBridges];
}

// ── Extraction functions ──

/**
 * Extract capitalised noun phrases (proper nouns).
 * Matches sequences of capitalised words (2+ words) or single capitalised words
 * that aren't at sentence starts.
 */
function extractProperNouns(text: string): string[] {
  const results = new Set<string>();

  // Multi-word proper nouns (e.g. "John Smith", "New York")
  const multiWord = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
  if (multiWord) {
    for (const match of multiWord) {
      results.add(match.toLowerCase());
    }
  }

  // Single capitalised words NOT at sentence starts
  // Split into sentences, skip first word of each
  const sentences = text.split(/[.!?]\s+/);
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const word = words[i].replace(/[^a-zA-Z]/g, '');
      if (word.length > 1 && /^[A-Z][a-z]+$/.test(word)) {
        results.add(word.toLowerCase());
      }
    }
  }

  return [...results];
}

/**
 * Extract role/title patterns.
 * Matches: "X is a Y", "X: Y", "X: Y role", "X, the Y"
 */
function extractRoles(text: string): string[] {
  const results = new Set<string>();
  const patterns = [
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+is\s+(?:a|an|the)\s+([a-z][a-z\s]+?)(?:[.,;]|$)/gi,
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*[:–-]\s*([A-Z][a-z][a-z\s]+?)(?:[.,;]|$)/g,
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*):\s*([A-Z][a-z][a-z\s]+?)(?:[.,;]|$)/g,
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*the\s+([a-z][a-z\s]+?)(?:[.,;]|$)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const role = match[2].trim().toLowerCase();
      if (role.length > 2 && role.length < 50) {
        results.add(role);
      }
    }
  }

  return [...results];
}

/**
 * Extract action verbs with their objects.
 * Looks for common verb patterns in the text.
 */
function extractActions(text: string): string[] {
  const results = new Set<string>();
  const actionVerbs = [
    'create', 'build', 'deploy', 'fix', 'update', 'delete', 'migrate',
    'configure', 'install', 'debug', 'test', 'review', 'implement',
    'refactor', 'optimize', 'optimise', 'analyse', 'analyze', 'monitor',
    'design', 'plan', 'decide', 'approve', 'reject', 'launch', 'ship',
  ];

  const lower = text.toLowerCase();
  for (const verb of actionVerbs) {
    // Match "verb the/a/an X" or "verb X" patterns
    const pattern = new RegExp(`\\b${verb}(?:s|ed|ing|d)?\\b\\s+(?:the\\s+|a\\s+|an\\s+)?([a-z][a-z\\s]{2,30})`, 'gi');
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      const obj = match[1].trim().replace(/\s+/g, ' ');
      if (obj.length > 2) {
        results.add(`${verb} ${obj}`);
      }
    }
  }

  return [...results];
}

/**
 * Get synonyms for a term from the lightweight synonym clusters.
 * Returns up to 3 synonyms.
 */
function getSynonyms(term: string): string[] {
  const lower = term.toLowerCase();
  return SYNONYM_CLUSTERS[lower] ?? [];
}

/**
 * Extract enrichment keywords from an entry's title + content.
 * Returns an array of synthetic search terms to append to the entry's keywords.
 *
 * General-purpose approach:
 * 1. Extract proper nouns
 * 2. Extract role/title patterns
 * 3. Extract action+object pairs
 * 4. Add synonyms for key concepts
 * 5. Apply domain-specific bridges (if registered)
 */
export function extractEnrichmentKeywords(
  title: string,
  content: string,
  existingKeywords: string[] = []
): string[] {
  const text = `${title} ${content}`;
  const lower = text.toLowerCase();
  const enriched = new Set<string>();
  const existingSet = new Set(existingKeywords.map(k => k.toLowerCase()));

  const addIfNew = (term: string) => {
    const t = term.toLowerCase().trim();
    if (t.length > 1 && !existingSet.has(t) && !lower.includes(t)) {
      enriched.add(t);
    }
  };

  // 1. Proper nouns
  const properNouns = extractProperNouns(text);
  // Don't add proper nouns themselves (they're in the text), but add them
  // as-is for better keyword matching
  for (const noun of properNouns) {
    existingSet.add(noun); // Track but don't necessarily add
  }

  // 2. Role/title patterns
  const roles = extractRoles(text);
  for (const role of roles) {
    addIfNew(role);
  }

  // 3. Action verbs with objects
  const actions = extractActions(text);
  for (const action of actions) {
    addIfNew(action);
  }

  // 4. Synonym expansion for words in the content
  const words = lower.split(/\s+/);
  const wordSet = new Set(words);
  for (const word of wordSet) {
    const clean = word.replace(/[^a-z]/g, '');
    const synonyms = getSynonyms(clean);
    for (const syn of synonyms) {
      if (!lower.includes(syn.toLowerCase())) {
        enriched.add(syn);
      }
    }
  }

  // 5. Domain-specific bridges (plugin system)
  for (const concept of domainBridges) {
    if (concept.trigger.test(text)) {
      for (const bridge of concept.bridges) {
        if (lower.includes(bridge.toLowerCase())) continue;
        if (concept.suppress?.some(s => lower.includes(s.toLowerCase()))) continue;
        if (existingSet.has(bridge.toLowerCase())) continue;
        enriched.add(bridge);
      }
    }
  }

  return [...enriched];
}

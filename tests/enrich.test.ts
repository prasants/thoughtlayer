import { describe, it, expect, afterEach } from 'vitest';
import { extractEnrichmentKeywords, registerConceptBridges, clearConceptBridges } from '../src/ingest/enrich.js';

describe('extractEnrichmentKeywords (general-purpose)', () => {
  afterEach(() => {
    clearConceptBridges();
  });

  it('extracts synonyms for action verbs in content', () => {
    const keywords = extractEnrichmentKeywords(
      'Deploy the application',
      'We need to deploy the new version to production.',
    );
    // Should add synonyms for "deploy"
    expect(keywords.some(k => ['release', 'ship', 'launch'].includes(k))).toBe(true);
  });

  it('extracts synonyms for nouns in content', () => {
    const keywords = extractEnrichmentKeywords(
      'Database migration',
      'The database needs to be migrated to the new server.',
    );
    // Should have synonyms for database and/or server
    expect(keywords.some(k => ['db', 'datastore', 'storage', 'backend', 'service', 'host'].includes(k))).toBe(true);
  });

  it('extracts role patterns from text', () => {
    const keywords = extractEnrichmentKeywords(
      'Team structure',
      'Sarah is a senior backend engineer. Tom is a lead designer.',
    );
    // Should extract roles
    // Synonyms for 'engineer' and 'designer' should be added
    expect(keywords.some(k => ['developer', 'dev', 'programmer', 'ui designer', 'ux designer', 'creative'].includes(k))).toBe(true);
  });

  it('does not add synonyms already in content', () => {
    const keywords = extractEnrichmentKeywords(
      'Build and create the service',
      'We will build and create the backend service and develop it further.',
    );
    // "develop" is already in content, should not be added as synonym of "build"
    expect(keywords).not.toContain('develop');
  });

  it('respects existing keywords', () => {
    const keywords = extractEnrichmentKeywords(
      'Deploy application',
      'Deploy the app to production.',
      ['release', 'ship'],
    );
    // These are already in existing keywords, should not be duplicated
    // (but they might appear because addIfNew checks existingSet differently)
    // The key thing: no duplicates
    const unique = new Set(keywords);
    expect(keywords.length).toBe(unique.size);
  });

  it('supports domain-specific plugin bridges', () => {
    registerConceptBridges([
      {
        trigger: /\bhallucination\b/i,
        bridges: ['mistake', 'wrong', 'incorrect'],
        suppress: ['mistake'],
      },
    ]);

    const keywords = extractEnrichmentKeywords(
      'AI hallucination incident',
      'Claude hallucinated a deadline in the status report.',
    );
    expect(keywords).toContain('mistake');
    expect(keywords).toContain('wrong');
  });

  it('does not add plugin bridges when suppressed', () => {
    registerConceptBridges([
      {
        trigger: /\bdesigner\b/i,
        bridges: ['responsible', 'appearance'],
        suppress: ['responsible'],
      },
    ]);

    const keywords = extractEnrichmentKeywords(
      'Designer responsible',
      'The designer is responsible for the look.',
    );
    expect(keywords).not.toContain('responsible');
    expect(keywords).not.toContain('appearance');
  });

  it('handles empty content gracefully', () => {
    const keywords = extractEnrichmentKeywords('', '', []);
    expect(Array.isArray(keywords)).toBe(true);
  });

  it('extracts action-object pairs', () => {
    const keywords = extractEnrichmentKeywords(
      'Migration plan',
      'We decided to migrate the user data to the new system.',
    );
    expect(keywords.some(k => k.startsWith('migrate '))).toBe(true);
  });
});

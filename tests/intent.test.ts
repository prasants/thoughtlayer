import { describe, it, expect } from 'vitest';
import { detectIntent } from '../src/retrieve/intent.js';

describe('Query Intent Detection', () => {
  it('detects "who" queries for people lookups', () => {
    const r = detectIntent('Who is the engineering lead?');
    expect(r.intent).toBe('who');
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(r.domainBoosts['team']).toBeGreaterThan(1);
  });

  it('detects "who is responsible for" pattern', () => {
    const r = detectIntent('Who is responsible for the billing system?');
    expect(r.intent).toBe('who');
  });

  it('detects "when" queries', () => {
    const r = detectIntent('When did we deploy v2.0?');
    expect(r.intent).toBe('when');
    expect(r.freshnessBoost).toBeGreaterThan(1);
  });

  it('detects "what happened" queries', () => {
    const r = detectIntent('What happened with the database outage?');
    expect(r.intent).toBe('what_happened');
    expect(r.freshnessBoost).toBeGreaterThan(2);
  });

  it('detects process/how queries', () => {
    const r = detectIntent('How do we deploy to production?');
    expect(r.intent).toBe('how');
    expect(r.domainBoosts).toEqual({});  // 'how' queries have no domain bias (prevents overfitting)
  });

  it('detects decision queries', () => {
    const r = detectIntent('What did we decide about the auth strategy?');
    expect(r.intent).toBe('decision');
    expect(r.recencySort).toBe(true);
  });

  it('detects "latest" / recency queries', () => {
    const r = detectIntent("What's the latest on the migration?");
    expect(r.intent).toBe('latest');
    expect(r.freshnessBoost).toBeGreaterThan(3);
    expect(r.recencySort).toBe(true);
  });

  it('returns general for ambiguous queries', () => {
    const r = detectIntent('Tell me about PostgreSQL');
    expect(r.intent).toBe('general');
  });

  it('detects incident-related keywords', () => {
    const r = detectIntent('What was the outage last Friday?');
    expect(r.intent).toBe('what_happened');
  });

  it('picks highest confidence when multiple patterns match', () => {
    const r = detectIntent('Who decided to use PostgreSQL?');
    // "who" pattern at start should win
    expect(r.intent).toBe('who');
  });
});

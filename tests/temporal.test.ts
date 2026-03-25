import { describe, it, expect } from 'vitest';
import { parseTemporalRefs, temporalBoost, extractTemporalRefs } from '../src/retrieve/temporal.js';

describe('Temporal Awareness', () => {
  const now = new Date('2026-03-19T12:00:00Z');

  it('parses "yesterday" reference', () => {
    const r = parseTemporalRefs('What happened yesterday?', now);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].label).toBe('yesterday');
    expect(r.refs[0].start.getDate()).toBe(18);
    expect(r.hasTemporalIntent).toBe(true);
  });

  it('parses "last week" reference', () => {
    const r = parseTemporalRefs('What did we discuss last week?', now);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].label).toBe('last week');
  });

  it('parses "last month" reference', () => {
    const r = parseTemporalRefs('Revenue figures from last month', now);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].start.getMonth()).toBe(1); // February
  });

  it('parses "in March" as named period', () => {
    const r = parseTemporalRefs('What happened in March?', now);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].type).toBe('named_period');
    expect(r.refs[0].start.getMonth()).toBe(2); // March
  });

  it('parses "3 days ago"', () => {
    const r = parseTemporalRefs('The incident 3 days ago', now);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].start.getDate()).toBe(16);
  });

  it('detects recency intent with "latest"', () => {
    const r = parseTemporalRefs('What is the latest status?', now);
    expect(r.preferRecent).toBe(true);
    expect(r.hasTemporalIntent).toBe(true);
  });

  it('returns no refs for non-temporal queries', () => {
    const r = parseTemporalRefs('How do we deploy?', now);
    expect(r.refs).toHaveLength(0);
    expect(r.hasTemporalIntent).toBe(false);
  });

  it('boosts entries within referenced time period', () => {
    const refs = parseTemporalRefs('yesterday', now).refs;
    // Entry from yesterday
    const boost = temporalBoost('2026-03-18T15:00:00Z', refs);
    expect(boost).toBe(3.0);

    // Entry from last week
    const oldBoost = temporalBoost('2026-03-10T15:00:00Z', refs);
    expect(oldBoost).toBe(1.0); // No boost, too far
  });

  it('gives proximity boost for near-miss entries', () => {
    const refs = parseTemporalRefs('yesterday', now).refs;
    // Entry from 2 days ago (close but not in range)
    const boost = temporalBoost('2026-03-17T15:00:00Z', refs);
    expect(boost).toBeGreaterThan(1.0);
    expect(boost).toBeLessThan(3.0);
  });

  it('extracts ISO dates from content', () => {
    const dates = extractTemporalRefs('Deployed on 2024-03-15 and updated on 2024-04-01');
    expect(dates).toContain('2024-03-15');
    expect(dates).toContain('2024-04-01');
  });

  it('extracts written dates from content', () => {
    const dates = extractTemporalRefs('Meeting on March 15, 2024');
    expect(dates).toContain('2024-03-15');
  });

  it('parses "this week"', () => {
    const r = parseTemporalRefs('What happened this week?', now);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].label).toBe('this week');
  });

  it('parses "2 weeks ago"', () => {
    const r = parseTemporalRefs('The change from 2 weeks ago', now);
    expect(r.refs).toHaveLength(1);
    expect(r.refs[0].label).toBe('2 weeks ago');
  });
});

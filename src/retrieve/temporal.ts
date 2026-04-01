/**
 * Temporal Awareness
 *
 * Parses relative time references in queries and entry content.
 * Provides time-range matching and temporal boosting for the retrieval pipeline.
 */

export interface TemporalRef {
  type: 'relative' | 'absolute' | 'named_period';
  label: string;
  start: Date;
  end: Date;
}

export interface TemporalParseResult {
  refs: TemporalRef[];
  hasTemporalIntent: boolean;
  preferRecent: boolean;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3,
  may: 4, june: 5, july: 6, august: 7,
  september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3,
  jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * Parse temporal references from a query string.
 */
export function parseTemporalRefs(query: string, now: Date = new Date()): TemporalParseResult {
  const refs: TemporalRef[] = [];
  const q = query.toLowerCase();
  let preferRecent = false;

  // "today"
  if (/\btoday\b/.test(q)) {
    const start = startOfDay(now);
    const end = endOfDay(now);
    refs.push({ type: 'relative', label: 'today', start, end });
  }

  // "yesterday"
  if (/\byesterday\b/.test(q)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    refs.push({ type: 'relative', label: 'yesterday', start: startOfDay(d), end: endOfDay(d) });
  }

  // "last week"
  if (/\blast week\b/.test(q)) {
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    refs.push({ type: 'relative', label: 'last week', start: startOfDay(start), end: endOfDay(end) });
  }

  // "last month"
  if (/\blast month\b/.test(q)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    refs.push({ type: 'relative', label: 'last month', start, end });
  }

  // "this week"
  if (/\bthis week\b/.test(q)) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    refs.push({ type: 'relative', label: 'this week', start: startOfDay(start), end: endOfDay(now) });
  }

  // "this month"
  if (/\bthis month\b/.test(q)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    refs.push({ type: 'relative', label: 'this month', start, end: endOfDay(now) });
  }

  // "last N days/weeks/months" — range pattern
  const lastNMatch = q.match(/last\s+(\d+)\s+(day|week|month)s?/);
  if (lastNMatch) {
    const n = parseInt(lastNMatch[1]);
    const unit = lastNMatch[2];
    const start = new Date(now);
    if (unit === 'day') start.setDate(start.getDate() - n);
    else if (unit === 'week') start.setDate(start.getDate() - n * 7);
    else if (unit === 'month') start.setMonth(start.getMonth() - n);
    refs.push({ type: 'relative', label: `last ${n} ${unit}s`, start: startOfDay(start), end: endOfDay(now) });
  }

  // "N days ago"
  const daysAgoMatch = q.match(/(\d+)\s+days?\s+ago/);
  if (daysAgoMatch) {
    const n = parseInt(daysAgoMatch[1]);
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    refs.push({ type: 'relative', label: `${n} days ago`, start: startOfDay(d), end: endOfDay(d) });
  }

  // "N weeks ago"
  const weeksAgoMatch = q.match(/(\d+)\s+weeks?\s+ago/);
  if (weeksAgoMatch) {
    const n = parseInt(weeksAgoMatch[1]);
    const end = new Date(now);
    end.setDate(end.getDate() - n * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    refs.push({ type: 'relative', label: `${n} weeks ago`, start: startOfDay(start), end: endOfDay(end) });
  }

  // "tomorrow"
  if (/\btomorrow\b/.test(q)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    refs.push({ type: 'relative', label: 'tomorrow', start: startOfDay(d), end: endOfDay(d) });
  }

  // "next week"
  if (/\bnext week\b/.test(q)) {
    const start = new Date(now);
    start.setDate(start.getDate() + 1);
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    refs.push({ type: 'relative', label: 'next week', start: startOfDay(start), end: endOfDay(end) });
  }

  // "next month"
  if (/\bnext month\b/.test(q)) {
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
    refs.push({ type: 'relative', label: 'next month', start, end });
  }

  // "in <month>" or "<month> <year>" — with year inference
  for (const [name, monthNum] of Object.entries(MONTHS)) {
    const monthPattern = new RegExp(`\\b(?:in\\s+)?${name}(?:\\s+(\\d{4}))?\\b`, 'i');
    const match = q.match(monthPattern);
    if (match) {
      let year: number;
      if (match[1]) {
        year = parseInt(match[1]);
      } else {
        // Year inference: if the month is in the future, use current year;
        // if it's in the past, use current year (most recent occurrence)
        year = now.getFullYear();
        const monthEnd = new Date(year, monthNum + 1, 0);
        // If the month has already fully passed and query doesn't indicate future,
        // still use current year (user likely means the most recent occurrence)
      }
      const start = new Date(year, monthNum, 1);
      const end = new Date(year, monthNum + 1, 0, 23, 59, 59, 999);
      refs.push({ type: 'named_period', label: `${name} ${year}`, start, end });
      break; // Only match one month
    }
  }

  // "last <day>"
  for (const [name, dayNum] of Object.entries(DAY_NAMES)) {
    if (new RegExp(`\\blast\\s+${name}\\b`, 'i').test(q)) {
      const d = new Date(now);
      const diff = (d.getDay() - dayNum + 7) % 7 || 7;
      d.setDate(d.getDate() - diff);
      refs.push({ type: 'relative', label: `last ${name}`, start: startOfDay(d), end: endOfDay(d) });
      break;
    }
  }

  // Recency indicators
  if (/\b(latest|most recent|current|newest|up.to.date|recent)\b/i.test(q)) {
    preferRecent = true;
  }

  return {
    refs,
    hasTemporalIntent: refs.length > 0 || preferRecent,
    preferRecent,
  };
}

/**
 * Calculate temporal boost for an entry given temporal refs from a query.
 * Returns a multiplier (1.0 = no boost, >1 = boosted).
 */
export function temporalBoost(entryDate: string, refs: TemporalRef[]): number {
  if (refs.length === 0) return 1.0;

  const entryTime = new Date(entryDate).getTime();
  let maxBoost = 1.0;

  for (const ref of refs) {
    const startTime = ref.start.getTime();
    const endTime = ref.end.getTime();

    if (entryTime >= startTime && entryTime <= endTime) {
      // Entry falls within the referenced time period
      maxBoost = Math.max(maxBoost, 3.0);
    } else {
      // Proximity boost: exponential decay based on distance from the time period
      const distMs = entryTime < startTime
        ? startTime - entryTime
        : entryTime - endTime;
      const distDays = distMs / (1000 * 60 * 60 * 24);
      if (distDays < 14) {
        // Exponential decay: 1.5 * e^(-distance/7) gives ~1.5 at 0 days, ~0.55 at 7 days
        const proximityBoost = 1.5 * Math.exp(-distDays / 7);
        if (proximityBoost > 1.0) {
          maxBoost = Math.max(maxBoost, proximityBoost);
        }
      }
    }
  }

  return maxBoost;
}

/**
 * Extract date references from content text.
 * Returns ISO date strings found in the content.
 */
export function extractTemporalRefs(content: string): string[] {
  const dates: string[] = [];

  // ISO dates: 2024-03-15
  const isoMatches = content.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (isoMatches) dates.push(...isoMatches);

  // Common formats: March 15, 2024 or 15 March 2024
  for (const [name, monthNum] of Object.entries(MONTHS)) {
    if (name.length < 3) continue;
    const pattern1 = new RegExp(`${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, 'gi');
    let m;
    while ((m = pattern1.exec(content)) !== null) {
      const day = parseInt(m[1]);
      const year = parseInt(m[2]);
      dates.push(`${year}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
    const pattern2 = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${name},?\\s+(\\d{4})`, 'gi');
    while ((m = pattern2.exec(content)) !== null) {
      const day = parseInt(m[1]);
      const year = parseInt(m[2]);
      dates.push(`${year}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  }

  return [...new Set(dates)];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

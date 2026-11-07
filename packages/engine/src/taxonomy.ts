import type { DomainKey } from './types';

// One structural hue (cobalt) for every domain — colour discipline: two colours + one accent.
export const DOMAINS: Record<DomainKey, { label: string; blurb: string; hue: number }> = {
  transport: { label: 'Transport', blurb: 'Buses, routes, trips and ridership', hue: 264 },
  automotive: { label: 'Automotive', blurb: 'Cars, dealers, sales and service', hue: 264 },
  engineering: { label: 'Tech Engineering', blurb: 'Repos, PRs, deploys and incidents', hue: 264 },
  commerce: { label: 'Commerce', blurb: 'Orders, carts, products and customers', hue: 264 },
  sports: { label: 'Sports', blurb: 'Athletes, events and medals', hue: 264 },
  media: { label: 'Media', blurb: 'Titles, genres, cast and catalogs', hue: 264 },
  health: { label: 'Healthcare', blurb: 'Patients, doctors and appointments', hue: 264 },
  finance: { label: 'Finance', blurb: 'Accounts, transactions and risk', hue: 264 },
  general: { label: 'General', blurb: 'Mixed real-world datasets', hue: 264 },
};

/**
 * The learning ladder every dataset track follows — from a first SELECT to the
 * kind of SQL used in analytics platforms and system-design interviews.
 */
export const TIERS = [
  { tier: 1, name: 'Foundations', blurb: 'SELECT, WHERE, ORDER BY — read a table with confidence' },
  { tier: 2, name: 'Aggregation', blurb: 'COUNT, SUM, GROUP BY, HAVING — turn rows into answers' },
  { tier: 3, name: 'Relationships', blurb: 'Inner, outer, self and anti joins across the schema' },
  { tier: 4, name: 'Composition', blurb: 'Subqueries, CTEs, CASE and date logic' },
  { tier: 5, name: 'Analytics', blurb: 'Window functions, rankings, running totals, cohorts' },
  { tier: 6, name: 'Architect', blurb: 'Metric design & performance: correct AND within a cost budget' },
] as const;

const TIER_TOPICS: Record<number, string[]> = {
  5: ['Window Functions', 'Ranking', 'Running Totals', 'Gaps & Islands', 'Recursive CTE'],
  4: ['Subqueries', 'CTE', 'CASE', 'Date & Time', 'Set Operations', 'Strings'],
  3: ['Joins', 'Outer Joins', 'Self Join', 'Anti Join'],
  2: ['Aggregation', 'GROUP BY', 'HAVING'],
};

/** Places a problem on the ladder from its topics (highest skill wins). */
export function inferTier(topics: string[]): number {
  for (const t of [5, 4, 3, 2]) if (topics.some((x) => TIER_TOPICS[t].includes(x))) return t;
  return 1;
}

/** Canonical topic ladder, ordered from foundations to advanced. */
export const TOPICS = [
  'Filtering',
  'Sorting',
  'Aggregation',
  'GROUP BY',
  'HAVING',
  'Joins',
  'Outer Joins',
  'Self Join',
  'Subqueries',
  'CTE',
  'Window Functions',
  'Ranking',
  'Running Totals',
  'Date & Time',
  'Strings',
  'CASE',
  'Set Operations',
  'Recursive CTE',
  'Gaps & Islands',
  'Anti Join',
] as const;

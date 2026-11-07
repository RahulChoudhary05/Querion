import { getDb } from '../db';
import { getDataset } from './registry';

/**
 * Weekly learning analytics — the signal the forge uses to decide WHAT to make
 * next week: topics people fail at get "stepping-stone" problems, abandoned
 * problems get flagged, popular domains get the fresh dataset.
 */
export interface WeeklyInsights {
  week: string;
  window: { from: string; to: string };
  activeLearners: number;
  submissions: number;
  acceptance: number;
  topics: { topic: string; attempts: number; learners: number; solveRate: number }[];
  weakTopics: string[];
  strongTopics: string[];
  hardest: { slug: string; title: string; attempts: number; solveRate: number }[];
  abandoned: { slug: string; title: string; learners: number }[];
  domains: { domain: string; attempts: number }[];
  tiers: { tier: number; learners: number; solveRate: number }[];
}

export async function computeInsights(week: string, days = 7): Promise<WeeklyInsights> {
  const db = await getDb();
  const from = new Date(Date.parse(week + 'T00:00:00Z') - days * 86400_000).toISOString().slice(0, 10);
  const params = [from, week];
  const learnerKey = `COALESCE(s.user_id::text, s.client_id)`;

  const totals = await db.query<{ learners: number; subs: number; acc: number }>(
    `SELECT COUNT(DISTINCT ${learnerKey})::int AS learners, COUNT(*)::int AS subs,
            COALESCE(AVG((s.verdict = 'ACCEPTED')::int), 0)::float AS acc
     FROM submissions s WHERE s.created_at >= $1::date AND s.created_at < $2::date`,
    params
  );

  // per learner × problem outcome, then roll up — avoids rewarding spammy retries
  const outcomes = `
    WITH lp AS (
      SELECT ${learnerKey} AS learner, s.problem_id, bool_or(s.verdict = 'ACCEPTED') AS solved, COUNT(*) AS tries
      FROM submissions s
      WHERE s.created_at >= $1::date AND s.created_at < $2::date
      GROUP BY 1, 2
    )`;

  const topics = await db.query<{ topic: string; attempts: number; learners: number; solve_rate: number }>(
    `${outcomes}
     SELECT t AS topic, SUM(lp.tries)::int AS attempts, COUNT(DISTINCT lp.learner)::int AS learners,
            AVG(lp.solved::int)::float AS solve_rate
     FROM lp JOIN problems p ON p.id = lp.problem_id, unnest(p.topics) t
     GROUP BY t ORDER BY attempts DESC`,
    params
  );

  const problems = await db.query<{ slug: string; title: string; attempts: number; learners: number; solve_rate: number; abandoned: number; dataset_key: string; tier: number }>(
    `${outcomes}
     SELECT p.slug, p.title, p.dataset_key, p.tier, SUM(lp.tries)::int AS attempts, COUNT(*)::int AS learners,
            AVG(lp.solved::int)::float AS solve_rate, COUNT(*) FILTER (WHERE NOT lp.solved)::int AS abandoned
     FROM lp JOIN problems p ON p.id = lp.problem_id
     GROUP BY p.id ORDER BY attempts DESC`,
    params
  );

  const domainCount = new Map<string, number>();
  const tierAgg = new Map<number, { learners: number; solved: number; n: number }>();
  for (const p of problems.rows) {
    const d = getDataset(p.dataset_key)?.domain ?? 'general';
    domainCount.set(d, (domainCount.get(d) ?? 0) + p.attempts);
    const t = tierAgg.get(p.tier) ?? { learners: 0, solved: 0, n: 0 };
    t.learners += p.learners;
    t.solved += p.solve_rate * p.learners;
    t.n += p.learners;
    tierAgg.set(p.tier, t);
  }

  const t = topics.rows.map((r) => ({ topic: r.topic, attempts: r.attempts, learners: r.learners, solveRate: Number(r.solve_rate.toFixed(3)) }));
  return {
    week,
    window: { from, to: week },
    activeLearners: totals.rows[0]?.learners ?? 0,
    submissions: totals.rows[0]?.subs ?? 0,
    acceptance: Number((totals.rows[0]?.acc ?? 0).toFixed(3)),
    topics: t,
    weakTopics: t.filter((x) => x.learners >= 2 && x.solveRate < 0.5).sort((a, b) => a.solveRate - b.solveRate).slice(0, 3).map((x) => x.topic),
    strongTopics: t.filter((x) => x.learners >= 2 && x.solveRate >= 0.8).map((x) => x.topic),
    hardest: problems.rows
      .filter((p) => p.learners >= 2)
      .sort((a, b) => a.solve_rate - b.solve_rate)
      .slice(0, 5)
      .map((p) => ({ slug: p.slug, title: p.title, attempts: p.attempts, solveRate: Number(p.solve_rate.toFixed(3)) })),
    abandoned: problems.rows.filter((p) => p.abandoned >= 2).slice(0, 5).map((p) => ({ slug: p.slug, title: p.title, learners: p.abandoned })),
    domains: [...domainCount.entries()].sort((a, b) => b[1] - a[1]).map(([domain, attempts]) => ({ domain, attempts })),
    tiers: [...tierAgg.entries()].sort((a, b) => a[0] - b[0]).map(([tier, v]) => ({ tier, learners: v.learners, solveRate: v.n ? Number((v.solved / v.n).toFixed(3)) : 0 })),
  };
}

export async function storeInsights(i: WeeklyInsights) {
  const db = await getDb();
  await db.query(
    `INSERT INTO insights (week, payload) VALUES ($1, $2::jsonb) ON CONFLICT (week) DO UPDATE SET payload = EXCLUDED.payload, created_at = now()`,
    [i.week, JSON.stringify(i)]
  );
}

export async function latestInsights(): Promise<WeeklyInsights | null> {
  const db = await getDb();
  const res = await db.query<{ payload: WeeklyInsights | string }>('SELECT payload FROM insights ORDER BY week DESC LIMIT 1');
  const p = res.rows[0]?.payload;
  return p ? (typeof p === 'string' ? JSON.parse(p) : p) : null;
}

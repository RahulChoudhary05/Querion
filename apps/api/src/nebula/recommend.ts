import { getDb } from '../db';
import { listProblems, statusMap, type Identity } from '../db/repo';
import { getDataset } from './registry';
import { mondayOf, today } from './scheduler';

export interface Prefs {
  level?: 'new' | 'some' | 'pro';
  domains?: string[];
}

export interface Rec {
  kind: 'continue' | 'strengthen' | 'fresh' | 'start';
  reason: string;
  slug: string;
  title: string;
  difficulty: string;
  tier: number;
  datasetName: string;
}

/**
 * "What should I do next?" — recognition over recall: the learner never has
 * to remember where they left off or what they are weak at.
 */
export async function recommendations(id: Identity, prefs: Prefs = {}): Promise<Rec[]> {
  const [problems, status] = await Promise.all([listProblems(), statusMap(id)]);
  const db = await getDb();
  const unsolved = problems.filter((p) => status[p.id] !== 'solved');
  const toRec = (p: (typeof problems)[number], kind: Rec['kind'], reason: string): Rec => ({
    kind,
    reason,
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    tier: p.tier,
    datasetName: getDataset(p.dataset_key)?.name ?? p.dataset_key,
  });
  const recs: Rec[] = [];
  const used = new Set<string>();
  const push = (r: Rec | null) => {
    if (r && !used.has(r.slug)) {
      used.add(r.slug);
      recs.push(r);
    }
  };

  const touched = problems.filter((p) => status[p.id]);
  const domainOf = (k: string) => getDataset(k)?.domain ?? 'general';
  const preferred = new Set(prefs.domains?.length ? prefs.domains : touched.map((p) => domainOf(p.dataset_key)));

  // 1. continue the ladder in the learner's main track
  const trackCounts = new Map<string, number>();
  for (const p of touched) trackCounts.set(p.dataset_key, (trackCounts.get(p.dataset_key) ?? 0) + 1);
  const mainTrack = [...trackCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const startTier = prefs.level === 'pro' ? 4 : prefs.level === 'some' ? 2 : 1;
  const ladder = unsolved
    .filter((p) => (mainTrack ? p.dataset_key === mainTrack : preferred.size ? preferred.has(domainOf(p.dataset_key)) : true))
    .filter((p) => touched.length > 0 || p.tier >= startTier)
    .sort((a, b) => a.tier - b.tier || a.id - b.id)[0];
  if (ladder) {
    push(
      toRec(
        ladder,
        touched.length ? 'continue' : 'start',
        touched.length ? `Next rung in ${getDataset(ladder.dataset_key)?.name ?? 'your track'} (Tier ${ladder.tier})` : `A good first problem for your level (Tier ${ladder.tier})`
      )
    );
  }

  // 2. strengthen the weakest topic (attempted, not yet solved)
  if (id.userId || id.clientId) {
    const where = id.userId ? 's.user_id = $1' : 's.client_id = $1 AND s.user_id IS NULL';
    const weak = await db.query<{ topic: string; fails: number }>(
      `SELECT t AS topic, COUNT(*) FILTER (WHERE s.verdict <> 'ACCEPTED')::int AS fails
       FROM submissions s JOIN problems p ON p.id = s.problem_id, unnest(p.topics) t
       WHERE ${where} GROUP BY t HAVING bool_and(s.verdict <> 'ACCEPTED') OR COUNT(*) FILTER (WHERE s.verdict <> 'ACCEPTED') >= 3
       ORDER BY fails DESC LIMIT 1`,
      [id.userId ?? id.clientId]
    );
    const topic = weak.rows[0]?.topic;
    if (topic) {
      const p = unsolved.filter((x) => x.topics.includes(topic) && !used.has(x.slug)).sort((a, b) => a.tier - b.tier)[0];
      if (p) push(toRec(p, 'strengthen', `Practice ${topic} — it tripped you up recently`));
    }
  }

  // 3. this week's fresh pack
  const week = await db.query<{ problem_id: number }>(`SELECT problem_id FROM schedule WHERE day = $1 AND cadence = 'weekly'`, [mondayOf(today())]);
  const fresh = unsolved.find((p) => week.rows.some((w) => w.problem_id === p.id) && !used.has(p.slug));
  if (fresh) push(toRec(fresh, 'fresh', 'New this week — forged from fresh data'));

  // fill up with the lowest unsolved tiers
  for (const p of unsolved.sort((a, b) => a.tier - b.tier)) {
    if (recs.length >= 3) break;
    push(toRec(p, 'continue', `Tier ${p.tier} · ${p.topics[0]}`));
  }
  return recs.slice(0, 3);
}

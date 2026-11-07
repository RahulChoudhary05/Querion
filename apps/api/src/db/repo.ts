import { fingerprint, type Cadence, type Difficulty, type JudgeReport, type TestCase } from '@querion/engine';
import { getDb } from './index';

export interface ProblemRow {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  dataset_key: string;
  topics: string[];
  statement: string;
  output_columns: string[];
  reference_sql: string;
  hints: [string, string, string];
  explanation: string;
  cadence: Cadence;
  origin: 'curated' | 'ai';
  forged_for: string | Date | null;
  order_matters: boolean;
  test_cases: TestCase[];
  quality: Record<string, unknown>;
  fingerprint: string;
  active: boolean;
  created_at: string | Date;
  tier: number;
  cost_budget: number | null;
}

const parseJson = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

function hydrate(r: ProblemRow): ProblemRow {
  return { ...r, hints: parseJson(r.hints), test_cases: parseJson(r.test_cases), quality: parseJson(r.quality) };
}

export function slugify(title: string) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

export interface NewProblem {
  title: string;
  difficulty: Difficulty;
  datasetKey: string;
  topics: string[];
  statement: string;
  outputColumns: string[];
  referenceSql: string;
  hints: [string, string, string];
  explanation: string;
  cadence: Cadence;
  origin: 'curated' | 'ai';
  forgedFor?: string | null;
  orderMatters: boolean;
  testCases: TestCase[];
  quality?: Record<string, unknown>;
  tier: number;
  /** Max planner cost for Architect problems (null = correctness only). */
  costBudget?: number | null;
}

export async function upsertProblem(p: NewProblem): Promise<ProblemRow> {
  const db = await getDb();
  let slug = slugify(p.title);
  const clash = await db.query<{ slug: string; reference_sql: string }>('SELECT slug, reference_sql FROM problems WHERE slug = $1', [slug]);
  if (clash.rows[0] && p.origin === 'ai') slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const res = await db.query<ProblemRow>(
    `INSERT INTO problems (slug, title, difficulty, dataset_key, topics, statement, output_columns, reference_sql, hints, explanation,
                           cadence, origin, forged_for, order_matters, test_cases, quality, fingerprint, tier, cost_budget)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19)
     ON CONFLICT (slug) DO UPDATE SET
       title = EXCLUDED.title, difficulty = EXCLUDED.difficulty, dataset_key = EXCLUDED.dataset_key, topics = EXCLUDED.topics,
       statement = EXCLUDED.statement, output_columns = EXCLUDED.output_columns, reference_sql = EXCLUDED.reference_sql,
       hints = EXCLUDED.hints, explanation = EXCLUDED.explanation, order_matters = EXCLUDED.order_matters,
       test_cases = EXCLUDED.test_cases, quality = EXCLUDED.quality, fingerprint = EXCLUDED.fingerprint,
       tier = EXCLUDED.tier, cost_budget = EXCLUDED.cost_budget
     RETURNING *`,
    [
      slug, p.title, p.difficulty, p.datasetKey, p.topics, p.statement, p.outputColumns, p.referenceSql,
      JSON.stringify(p.hints), p.explanation, p.cadence, p.origin, p.forgedFor ?? null, p.orderMatters,
      JSON.stringify(p.testCases), JSON.stringify(p.quality ?? {}), fingerprint(p.referenceSql), p.tier, p.costBudget ?? null,
    ]
  );
  return hydrate(res.rows[0]);
}

export async function getProblemBySlug(slug: string): Promise<ProblemRow | null> {
  const db = await getDb();
  const res = await db.query<ProblemRow>('SELECT * FROM problems WHERE slug = $1 AND active', [slug]);
  return res.rows[0] ? hydrate(res.rows[0]) : null;
}

export async function getProblemById(id: number): Promise<ProblemRow | null> {
  const db = await getDb();
  const res = await db.query<ProblemRow>('SELECT * FROM problems WHERE id = $1', [id]);
  return res.rows[0] ? hydrate(res.rows[0]) : null;
}

export interface ProblemListItem {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  dataset_key: string;
  topics: string[];
  cadence: Cadence;
  origin: string;
  forged_for: string | null;
  created_at: string;
  solved_by: number;
  attempts: number;
  tier: number;
  cost_budget: number | null;
}

export async function listProblems(): Promise<ProblemListItem[]> {
  const db = await getDb();
  const res = await db.query<ProblemListItem>(
    `SELECT p.id, p.slug, p.title, p.difficulty, p.dataset_key, p.topics, p.cadence, p.origin, p.tier, p.cost_budget,
            to_char(p.forged_for, 'YYYY-MM-DD') AS forged_for, p.created_at,
            COUNT(DISTINCT COALESCE(s.user_id::text, s.client_id)) FILTER (WHERE s.verdict = 'ACCEPTED')::int AS solved_by,
            COUNT(s.id)::int AS attempts
     FROM problems p
     LEFT JOIN submissions s ON s.problem_id = p.id
     WHERE p.active
     GROUP BY p.id
     ORDER BY p.tier, CASE p.difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, p.id`
  );
  return res.rows;
}

export async function existingForDataset(datasetKey: string) {
  const db = await getDb();
  const res = await db.query<{ title: string; fingerprint: string; topics: string[] }>(
    'SELECT title, fingerprint, topics FROM problems WHERE dataset_key = $1',
    [datasetKey]
  );
  return res.rows;
}

export interface Identity {
  userId: number | null;
  clientId: string | null;
}

const who = (id: Identity, a = '') =>
  id.userId
    ? { clause: `${a}user_id = $1`, param: id.userId as unknown }
    : { clause: `${a}client_id = $1 AND ${a}user_id IS NULL`, param: id.clientId as unknown };

export async function recordSubmission(id: Identity, problemId: number, sql: string, report: JudgeReport) {
  const db = await getDb();
  await db.query(
    `INSERT INTO submissions (user_id, client_id, problem_id, sql, verdict, passed, total, runtime_ms, plan_cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id.userId, id.clientId, problemId, sql, report.verdict, report.passed, report.total, report.ms, report.efficiency?.userCost ?? null]
  );
}

export async function submissionsFor(id: Identity, problemId: number) {
  if (!id.userId && !id.clientId) return [];
  const db = await getDb();
  const w = who(id);
  const res = await db.query(
    `SELECT id, sql, verdict, passed, total, runtime_ms, plan_cost, created_at FROM submissions
     WHERE ${w.clause} AND problem_id = $2 ORDER BY created_at DESC LIMIT 30`,
    [w.param, problemId]
  );
  return res.rows;
}

export async function hasSolved(id: Identity, problemId: number): Promise<boolean> {
  if (!id.userId && !id.clientId) return false;
  const db = await getDb();
  const w = who(id);
  const res = await db.query(`SELECT 1 FROM submissions WHERE ${w.clause} AND problem_id = $2 AND verdict = 'ACCEPTED' LIMIT 1`, [w.param, problemId]);
  return res.rows.length > 0;
}

export async function statusMap(id: Identity): Promise<Record<number, 'solved' | 'attempted'>> {
  if (!id.userId && !id.clientId) return {};
  const db = await getDb();
  const w = who(id);
  const res = await db.query<{ problem_id: number; solved: boolean }>(
    `SELECT problem_id, bool_or(verdict = 'ACCEPTED') AS solved FROM submissions WHERE ${w.clause} GROUP BY problem_id`,
    [w.param]
  );
  return Object.fromEntries(res.rows.map((r) => [r.problem_id, r.solved ? 'solved' : 'attempted']));
}

/** Moves anonymous progress onto an account after sign-up / login. */
export async function claimGuestProgress(userId: number, clientId: string | null) {
  if (!clientId) return;
  const db = await getDb();
  await db.query('UPDATE submissions SET user_id = $1 WHERE client_id = $2 AND user_id IS NULL', [userId, clientId]);
}

export async function profileStats(id: Identity) {
  const db = await getDb();
  const w = who(id, 's.');
  const solved = await db.query<{ difficulty: string; n: number }>(
    `SELECT p.difficulty, COUNT(DISTINCT p.id)::int AS n
     FROM submissions s JOIN problems p ON p.id = s.problem_id
     WHERE ${w.clause} AND s.verdict = 'ACCEPTED'
     GROUP BY p.difficulty`,
    [w.param]
  );
  const heat = await db.query<{ day: string; n: number }>(
    `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
     FROM submissions s WHERE ${w.clause} AND created_at > now() - INTERVAL '365 days'
     GROUP BY 1 ORDER BY 1`,
    [w.param]
  );
  const topics = await db.query<{ topic: string; n: number }>(
    `SELECT t AS topic, COUNT(DISTINCT p.id)::int AS n
     FROM submissions s JOIN problems p ON p.id = s.problem_id, unnest(p.topics) t
     WHERE ${w.clause} AND s.verdict = 'ACCEPTED'
     GROUP BY t ORDER BY n DESC`,
    [w.param]
  );
  const totals = await db.query<{ difficulty: string; n: number }>(`SELECT difficulty, COUNT(*)::int AS n FROM problems WHERE active GROUP BY difficulty`);
  const days = new Set(heat.rows.map((r) => r.day));
  let streak = 0;
  const d = new Date();
  // streak counts today if active, otherwise starts from yesterday
  if (!days.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return {
    solved: Object.fromEntries(solved.rows.map((r) => [r.difficulty, r.n])),
    totals: Object.fromEntries(totals.rows.map((r) => [r.difficulty, r.n])),
    heatmap: heat.rows,
    topics: topics.rows,
    streak,
  };
}

export async function scheduleFor(day: string) {
  const db = await getDb();
  const res = await db.query<{ cadence: string; problem_id: number; day: string }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, cadence, problem_id FROM schedule WHERE day = $1`,
    [day]
  );
  return res.rows;
}

export async function addSchedule(day: string, cadence: Cadence, problemId: number) {
  const db = await getDb();
  await db.query('INSERT INTO schedule (day, cadence, problem_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [day, cadence, problemId]);
}

export async function recentScheduledIds(days: number): Promise<number[]> {
  const db = await getDb();
  const res = await db.query<{ problem_id: number }>(`SELECT DISTINCT problem_id FROM schedule WHERE day > CURRENT_DATE - $1::int`, [days]);
  return res.rows.map((r) => r.problem_id);
}

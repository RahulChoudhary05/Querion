import { z } from 'zod';
import {
  describeSchema,
  fingerprint,
  hashString,
  inferTier,
  TOPICS,
  type Cadence,
  type Dataset,
  type Difficulty,
  type ForgeCheck,
  type JudgeReport,
} from '@querion/engine';
import { chatJson, type ChatMessage } from '../ai/llm';
import { getDb } from '../db';
import { existingForDataset, upsertProblem, type ProblemRow } from '../db/repo';
import { env } from '../env';
import { pool } from '../judge/pool';
import { CURATED } from './curated';
import { datasets } from './registry';

/**
 * NEBULA — the problem forge.
 *
 *   pick dataset+topic → LLM drafts problem + reference SQL
 *     → run on real Postgres (PGlite) across 4 data variants   (must succeed)
 *     → determinism check on mirrored storage order            (must match)
 *     → quality gates (row counts, columns named, novelty)     (must pass)
 *     → blind solve by a second model from the statement only  (must agree)
 *     → publish with computed expected outputs
 *
 * Any failure is fed back to the generator for up to 2 repairs. Nothing the
 * model *claims* is trusted; only what Postgres computes.
 */

const Draft = z.object({
  title: z.string().min(4).max(70),
  statement: z.string().min(60),
  topics: z.array(z.string()).min(1).transform((t) => t.slice(0, 4)),
  reference_sql: z.string().min(10),
  output_columns: z.array(z.string()).min(1).max(8),
  hints: z.array(z.string()).min(3).transform((h) => [h[0], h[1], h[2]] as [string, string, string]),
  explanation: z.string().min(20),
});
type Draft = z.infer<typeof Draft>;

const Solve = z.object({ sql: z.string().min(6) });

const Review = z.object({
  clarity: z.number().min(0).max(10),
  realism: z.number().min(0).max(10),
  difficulty_fit: z.number().min(0).max(10),
  teaching_value: z.number().min(0).max(10),
  overall: z.number().min(0).max(10),
  issues: z.array(z.string()).default([]),
});
type Review = z.infer<typeof Review>;

/** Minimum rubric scores for a forged problem to be published. */
const MIN_OVERALL = 7;
const MIN_FIT = 6;

/**
 * What the reference SQL must actually exercise for each ladder tier — a
 * deterministic guard against "Hard" problems that are really one GROUP BY.
 */
export function tierProfileIssue(sql: string, tier: number): string | null {
  const s = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''").toLowerCase();
  const has = (re: RegExp) => re.test(s);
  const joins = (s.match(/\bjoin\b/g) ?? []).length;
  const ctes = (s.match(/\bas\s*\(\s*select\b/g) ?? []).length;
  const windowFn = has(/\bover\s*\(/);
  const agg = has(/\b(count|sum|avg|min|max|percentile_cont|string_agg|array_agg|bool_or|bool_and)\s*\(/);
  const subquery = has(/\(\s*select\b/) || has(/\bexists\s*\(/) || has(/\bin\s*\(\s*select/);
  switch (tier) {
    case 1:
      if (joins > 0 || windowFn || ctes > 0) return 'Tier 1 (Foundations) must be answerable from ONE table with WHERE/ORDER BY/simple expressions — no joins, CTEs or window functions.';
      return null;
    case 2:
      if (!agg && !has(/\bgroup by\b/)) return 'Tier 2 (Aggregation) must require aggregation (GROUP BY / aggregate functions).';
      if (windowFn) return 'Tier 2 must not need window functions.';
      return null;
    case 3:
      if (joins === 0 && !has(/\bexists\s*\(/)) return 'Tier 3 (Relationships) must require combining tables (JOIN, outer join, self join or anti-join).';
      if (windowFn) return 'Tier 3 must not need window functions.';
      return null;
    case 4:
    {
      // conditional logic (CASE / FILTER) and date arithmetic are composition skills too
      const conditional = has(/\bcase\b/) || has(/\bfilter\s*\(\s*where\b/);
      const dateLogic = has(/\b(date_trunc|extract|interval|age|to_char)\b/) || has(/\b(date|timestamp)\s*''/) || has(/::(date|timestamp)\b/);
      if (!subquery && ctes === 0 && !conditional && !dateLogic) return 'Tier 4 (Composition) must require a subquery/CTE, CASE/FILTER logic or date arithmetic.';
      return null;
    }
    case 5:
      if (!windowFn && !has(/\bdistinct\s+on\s*\(/)) return 'Tier 5 (Analytics) must require a window function (ranking, LAG/LEAD, running total) or DISTINCT ON top-N-per-group.';
      return null;
    case 6:
      if (ctes < 2 && !(windowFn && agg)) return 'Tier 6 (Architect) must be a multi-step model: at least two CTEs, or window functions over aggregates.';
      return null;
    default:
      return null;
  }
}

export interface ForgeOptions {
  cadence: Cadence;
  date: string;
  datasetKey?: string;
  difficulty?: Difficulty;
  topic?: string;
  /** Ladder tier 1–6; 6 = Architect (metric design + performance budget). */
  tier?: number;
  /** Why this problem is being made (from weekly insights), passed to the generator. */
  focus?: string;
}

export interface ForgeLog {
  step: string;
  ok: boolean;
  detail?: string;
  at: string;
}

const TOPIC_BY_DIFFICULTY: Record<Difficulty, string[]> = {
  Easy: ['Filtering', 'Sorting', 'Aggregation', 'GROUP BY', 'Joins', 'Strings', 'CASE'],
  Medium: ['HAVING', 'Outer Joins', 'Self Join', 'Subqueries', 'CTE', 'Date & Time', 'Anti Join', 'Set Operations', 'CASE'],
  Hard: ['Window Functions', 'Ranking', 'Running Totals', 'Gaps & Islands', 'Recursive CTE', 'CTE', 'Date & Time'],
};

/** Deterministic but rotating choice so every day explores a different dataset/topic. */
const TIER_DIFFICULTY: Record<number, Difficulty> = { 1: 'Easy', 2: 'Easy', 3: 'Medium', 4: 'Medium', 5: 'Hard', 6: 'Hard' };
const TIER_TOPICS: Record<number, string[]> = {
  1: ['Filtering', 'Sorting', 'Strings'],
  2: ['Aggregation', 'GROUP BY', 'HAVING'],
  3: ['Joins', 'Outer Joins', 'Self Join', 'Anti Join'],
  // Set Operations is only used when explicitly requested — auto-picked it tends to produce contrived problems.
  4: ['Subqueries', 'CTE', 'CASE', 'Date & Time'],
  5: ['Window Functions', 'Ranking', 'Running Totals', 'Gaps & Islands'],
  6: ['CTE', 'Window Functions', 'Aggregation', 'Outer Joins'],
};

export async function plan(opts: ForgeOptions) {
  const all = [...datasets().values()];
  const seed = hashString(`${opts.date}:${opts.cadence}:${opts.difficulty ?? ''}:${opts.tier ?? ''}:${opts.topic ?? ''}`);
  const dataset = (opts.datasetKey && datasets().get(opts.datasetKey)) || all[seed % all.length];
  const difficulty: Difficulty = opts.difficulty ?? (opts.tier ? TIER_DIFFICULTY[opts.tier] : (['Easy', 'Medium', 'Medium', 'Hard'] as Difficulty[])[(seed >>> 3) % 4]);
  const existing = await existingForDataset(dataset.key);
  const covered = new Map<string, number>();
  for (const e of existing) for (const t of e.topics) covered.set(t, (covered.get(t) ?? 0) + 1);
  const candidates = opts.tier ? TIER_TOPICS[opts.tier] : TOPIC_BY_DIFFICULTY[difficulty];
  const topic =
    opts.topic ??
    [...candidates].sort((a, b) => (covered.get(a) ?? 0) - (covered.get(b) ?? 0) || hashString(a + seed) - hashString(b + seed))[0];
  return { dataset, difficulty, topic, existing };
}

/** Two hand-written curated problems near the target tier, shown as the quality bar ("house style"). */
function exemplars(tier: number | undefined, datasetKey: string): string {
  const t = tier ?? 3;
  const pool = CURATED.filter((p) => p.dataset !== datasetKey)
    .map((p) => ({ p, d: Math.abs((p.tier ?? inferTier(p.topics)) - t) }))
    .sort((a, b) => a.d - b.d || hashString(a.p.title + t) - hashString(b.p.title + t))
    .slice(0, 2)
    .map(({ p }) => p);
  return pool
    .map((p, i) => `--- REFERENCE EXAMPLE ${i + 1} (${p.difficulty}, ${p.topics.join(', ')}) ---\nTITLE: ${p.title}\nSTATEMENT:\n${p.statement}\nREFERENCE SQL:\n${p.sql}`)
    .join('\n\n');
}

function generatorPrompt(ds: Dataset, difficulty: Difficulty, topic: string, existingTitles: string[], tier?: number, focus?: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are a world-class SQL interview problem setter (think top-tier data-engineering interviews). You write ORIGINAL, realistic business problems over a given PostgreSQL 17 schema, with an exact reference solution.

Hard rules for reference_sql:
- One read-only SELECT (CTEs allowed). PostgreSQL 17 syntax. Use only tables/columns in the schema.
- Deterministic: if the result is ordered or uses LIMIT, the ORDER BY must be a TOTAL order (add tie-breakers like a name or id).
- Never use NOW(), CURRENT_DATE, random(), or anything time/session dependent — use fixed literal dates inside the data range.
- Round all non-integer numeric outputs with ROUND(x::numeric, 2) (or the precision you state).
- Result size between 1 and 60 rows on the sample data.
- Output columns must be explicitly aliased with snake_case names, matching output_columns exactly and in order.

Hard rules for the statement (Markdown, 60–180 words):
- A short business context (one sentence), then a precise spec: every filter, every edge case (NULL handling, ties, inclusive/exclusive date bounds), rounding, and the exact output columns in backticks in order, and the exact ordering.
- Someone who never sees reference_sql must be able to write a query producing the IDENTICAL result.
- Do not mention the solution technique in the statement.

hints: [nudge without SQL, concept-level steps, a SQL skeleton with ___ blanks that cannot run as-is].
explanation: 2–3 sentences on the optimal approach and why.

Match the precision, tone and realism of these reference problems written by our editors (do NOT copy their scenarios):

${exemplars(tier, ds.key)}

Reply with JSON only: {"title","statement","topics","reference_sql","output_columns","hints","explanation"}`,
    },
    {
      role: 'user',
      content: `DATASET: ${ds.name} (${ds.domain}) — ${ds.description}

${describeSchema(ds, 3)}

Write ONE new ${difficulty} problem whose main skill is "${topic}" (topics must come from: ${TOPICS.join(', ')}).
${difficulty === 'Hard' ? 'Hard means multi-step reasoning: e.g. window functions over aggregates, gaps & islands, cohort or funnel logic, or multiple CTEs.' : ''}
${difficulty === 'Easy' ? 'Easy means one or two clauses beyond SELECT/FROM; still a realistic question.' : ''}
${tier ? `Ladder tier ${tier}/6 (${['', 'Foundations', 'Aggregation', 'Relationships', 'Composition', 'Analytics', 'Architect'][tier]}).` : ''}
${tier === 6 ? 'ARCHITECT tier: design a realistic metric/reporting model the way a data/analytics engineer would (e.g. a scorecard, a funnel, a cohort table, a one-row-per-entity "360" model) that requires pre-aggregating facts at the right grain, avoiding join fan-out, and computing each metric once. The reference must be the efficient approach. End the statement with a line: "> ⚡ **Performance budget:** your query must stay within 1.6× of the reference plan cost."' : ''}
${focus ? `Pedagogical focus from last week's learner analytics: ${focus}` : ''}
It must be different from these existing problems on this dataset: ${existingTitles.length ? existingTitles.map((t) => `"${t}"`).join(', ') : '(none yet)'}.`,
    },
  ];
}

async function verify(ds: Dataset, sql: string): Promise<ForgeCheck> {
  return pool.run<ForgeCheck>({ type: 'forge', dataset: ds, sql }, 20_000);
}

function qualityGate(draft: Draft, check: ForgeCheck, existing: { title: string; fingerprint: string }[]): string | null {
  const sample = check.testCases[0]?.expected;
  if (!sample) return 'No sample result.';
  const cols = sample.fields.map((f) => f.name);
  if (check.sampleRowCount > 60) return `Result has ${check.sampleRowCount} rows on the sample data; keep it ≤ 60 (aggregate or filter more).`;
  if (cols.length !== draft.output_columns.length || cols.some((c, i) => c !== draft.output_columns[i])) {
    return `The query returns columns [${cols.join(', ')}] but output_columns says [${draft.output_columns.join(', ')}]. Make them identical (alias every column).`;
  }
  const missing = cols.filter((c) => !draft.statement.includes(c));
  if (missing.length) return `The statement must name every output column in backticks; missing: ${missing.join(', ')}.`;
  if (/\bselect\s+\*\s+from\s+\w+\s*;?\s*$/i.test(draft.reference_sql)) return 'Too trivial.';
  if (/\b(now|current_date|current_timestamp|random|clock_timestamp)\b/i.test(draft.reference_sql)) return 'Uses non-deterministic functions.';
  const fp = fingerprint(draft.reference_sql);
  if (existing.some((e) => e.fingerprint === fp || e.title.toLowerCase() === draft.title.toLowerCase())) return 'Duplicate of an existing problem.';
  // every hidden variant identical to sample AND single value → probably constant / degenerate
  const allEmpty = check.testCases.slice(1).every((t) => t.expected.rows.length === 0);
  if (allEmpty) return 'Result is empty on every hidden variant; the problem is too narrow.';
  return null;
}

/** Cross-model check: a second model solves from the statement alone; its output must match the reference on all variants. */
async function blindSolve(ds: Dataset, draft: Draft, check: ForgeCheck, generator: string) {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are an expert PostgreSQL 17 engineer. Solve the problem exactly as specified. Reply with JSON {"sql": "..."} only.' },
    { role: 'user', content: `SCHEMA:\n${describeSchema(ds, 2)}\n\nPROBLEM: ${draft.title}\n${draft.statement}` },
  ];
  let last: { provider: string; sql: string; report: JudgeReport } | null = null;
  // A solver *runtime* error is the solver's bug, not statement ambiguity — let it fix its own query once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, provider } = await chatJson(messages, Solve, { temperature: 0, maxTokens: 1200, avoid: generator, reasoning: 'low' });
    const report = await pool.run<JudgeReport>({ type: 'judge', dataset: ds, testCases: check.testCases, sql: data.sql, orderMatters: check.orderMatters }, 20_000);
    last = { provider, sql: data.sql, report };
    if (report.verdict !== 'RUNTIME_ERROR' && report.verdict !== 'REJECTED') break;
    const err = report.cases.find((c) => c.verdict !== 'ACCEPTED')?.message ?? report.verdict;
    messages.push({ role: 'assistant', content: JSON.stringify(data) }, { role: 'user', content: `PostgreSQL error: ${err}\nFix your query. Reply with JSON {"sql": "..."} only.` });
  }
  const { provider, sql, report } = last!;
  return { passed: report.verdict === 'ACCEPTED', provider, sql, report, solverError: report.verdict === 'RUNTIME_ERROR' || report.verdict === 'REJECTED' };
}

/** Editorial review by a different model: is this a problem worth a learner's time at this level? */
async function critique(ds: Dataset, draft: Draft, difficulty: Difficulty, tier: number, sampleRows: number, generator: string) {
  const { data, provider } = await chatJson(
    [
      {
        role: 'system',
        content: `You are the head editor of a premium SQL interview-prep platform. Score a candidate problem strictly (0–10 each). 7 means "good enough to publish", 9+ is exceptional. Be harsh on: vague specs, unrealistic business framing, trivial tasks dressed as hard, hard tasks labelled easy, toy questions that teach nothing.
Reply JSON only: {"clarity","realism","difficulty_fit","teaching_value","overall","issues":[short actionable fixes]}`,
      },
      {
        role: 'user',
        content: `DATASET: ${ds.name} (${ds.domain})
TARGET LEVEL: ${difficulty}, ladder tier ${tier}/6 (1 Foundations, 2 Aggregation, 3 Relationships, 4 Composition, 5 Analytics, 6 Architect)
TITLE: ${draft.title}
STATEMENT:
${draft.statement}
REFERENCE SQL:
${draft.reference_sql}
RESULT SIZE ON SAMPLE DATA: ${sampleRows} rows`,
      },
    ],
    Review,
    { temperature: 0, maxTokens: 700, avoid: generator, reasoning: 'low' }
  );
  return { review: data, provider, pass: data.overall >= MIN_OVERALL && data.difficulty_fit >= MIN_FIT && data.clarity >= MIN_FIT };
}

export async function forgeProblem(opts: ForgeOptions): Promise<{ problem: ProblemRow | null; log: ForgeLog[] }> {
  const log: ForgeLog[] = [];
  const note = (step: string, ok: boolean, detail?: string) => log.push({ step, ok, detail: detail?.slice(0, 600), at: new Date().toISOString() });
  const { dataset: ds, difficulty, topic, existing } = await plan(opts);
  note('plan', true, `${ds.key} · ${difficulty} · ${topic}`);

  const db = await getDb();
  const run = await db.query<{ id: number }>('INSERT INTO forge_runs (cadence, dataset_key) VALUES ($1, $2) RETURNING id', [opts.cadence, ds.key]);
  const runId = run.rows[0].id;
  const finish = async (status: string, problemId: number | null) => {
    await db.query('UPDATE forge_runs SET finished_at = now(), status = $2, problem_id = $3, log = $4::jsonb WHERE id = $1', [runId, status, problemId, JSON.stringify(log)]);
  };

  const messages = generatorPrompt(ds, difficulty, topic, existing.map((e) => e.title), opts.tier, opts.focus);
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data: draft, provider } = await chatJson(messages, Draft, { temperature: attempt === 1 ? 0.8 : 0.4, maxTokens: 3500, reasoning: 'low' });
      note(`draft#${attempt}`, true, `${provider}: ${draft.title}`);
      messages.push({ role: 'assistant', content: JSON.stringify(draft) });

      const check = await verify(ds, draft.reference_sql);
      if (!check.ok) {
        note(`verify#${attempt}`, false, check.reason);
        messages.push({ role: 'user', content: `Your reference_sql failed verification on real PostgreSQL: ${check.reason}\nFix the problem and return the full corrected JSON.` });
        continue;
      }
      note(`verify#${attempt}`, true, `rows ${check.testCases.map((t) => t.expected.rows.length).join('/')}`);

      const targetTier = opts.tier ?? inferTier([topic, ...draft.topics]);
      const gate = qualityGate(draft, check, existing) ?? tierProfileIssue(draft.reference_sql, targetTier);
      if (gate) {
        note(`quality#${attempt}`, false, gate);
        messages.push({ role: 'user', content: `Quality gate failed: ${gate}\nReturn the full corrected JSON.` });
        continue;
      }

      let blind: Awaited<ReturnType<typeof blindSolve>> | null = null;
      try {
        blind = await blindSolve(ds, draft, check, provider);
        note(`blind-solve#${attempt}`, blind.passed, `${blind.provider}: ${blind.report.verdict} ${blind.report.cases.find((c) => c.verdict !== 'ACCEPTED')?.message ?? ''}`);
      } catch (e) {
        note(`blind-solve#${attempt}`, false, (e as Error).message);
      }
      // solver couldn't produce runnable SQL even after fixing it → inconclusive, not evidence of ambiguity
      const inconclusive = !!blind && !blind.passed && blind.solverError;
      if (env.FORGE_REQUIRE_BLIND_SOLVE && blind && !blind.passed && !inconclusive) {
        const failing = blind.report.cases.find((c) => c.verdict !== 'ACCEPTED');
        messages.push({
          role: 'user',
          content: `An independent expert solved your statement WITHOUT seeing reference_sql and got a different answer, so the statement is ambiguous or underspecified.
Their SQL:\n${blind.sql}\nDifference: ${failing?.message ?? blind.report.verdict}
Rewrite the statement so the intended result is the only reasonable reading (state ties, NULLs, rounding, bounds, ordering explicitly). Keep reference_sql unless it is the one that is unreasonable. Return the full corrected JSON.`,
        });
        continue;
      }

      let critic: Awaited<ReturnType<typeof critique>> | null = null;
      try {
        critic = await critique(ds, draft, difficulty, targetTier, check.sampleRowCount, provider);
        const r = critic.review;
        note(`critic#${attempt}`, critic.pass, `${critic.provider}: overall ${r.overall} · clarity ${r.clarity} · realism ${r.realism} · fit ${r.difficulty_fit} · teaching ${r.teaching_value}${r.issues.length ? ` — ${r.issues.join('; ')}` : ''}`);
      } catch (e) {
        note(`critic#${attempt}`, false, (e as Error).message);
      }
      // without a confirming blind solve, demand a clearly-written statement
      if (critic && inconclusive && critic.review.clarity < 8) {
        critic.pass = false;
        critic.review.issues.push('Statement clarity must be ≥ 8 when no independent solver could confirm it — remove every ambiguity.');
      }
      if (env.FORGE_REQUIRE_BLIND_SOLVE && !critic) {
        note(`critic#${attempt}`, false, 'no reviewer available — not publishing an unreviewed problem');
        await finish('rejected', null);
        return { problem: null, log };
      }
      if (critic && !critic.pass) {
        messages.push({
          role: 'user',
          content: `Our editor rejected this draft (overall ${critic.review.overall}/10, difficulty fit ${critic.review.difficulty_fit}/10, clarity ${critic.review.clarity}/10). Issues:\n- ${critic.review.issues.join('\n- ') || 'not compelling enough'}\nRevise it into a publish-quality ${difficulty} problem and return the full corrected JSON.`,
        });
        continue;
      }

      const sample = check.testCases[0].expected;
      const tier = targetTier;
      let costBudget: number | null = null;
      if (tier === 6) {
        const plan = await pool.run<{ ok: boolean; cost?: number }>({ type: 'explain', dataset: ds, sql: draft.reference_sql }, 20_000);
        if (plan.ok && plan.cost) costBudget = Math.round(plan.cost * 1.6 * 100) / 100;
      }
      const problem = await upsertProblem({
        tier,
        costBudget,
        title: draft.title,
        difficulty,
        datasetKey: ds.key,
        topics: [...new Set([topic, ...draft.topics.filter((t) => (TOPICS as readonly string[]).includes(t))])].slice(0, 4),
        statement: draft.statement,
        outputColumns: sample.fields.map((f) => f.name),
        referenceSql: draft.reference_sql,
        hints: draft.hints,
        explanation: draft.explanation,
        cadence: opts.cadence,
        origin: 'ai',
        forgedFor: opts.date,
        orderMatters: check.orderMatters,
        testCases: check.testCases,
        quality: {
          generator: provider,
          attempts: attempt,
          blindSolve: blind ? (blind.passed ? 'passed' : blind.solverError ? 'inconclusive' : 'failed') : 'skipped',
          blindSolver: blind?.provider ?? null,
          review: critic ? { ...critic.review, reviewer: critic.provider } : null,
          verifiedAt: new Date().toISOString(),
          variants: check.testCases.map((t) => ({ id: t.id, rows: t.expected.rows.length })),
        },
      });
      note('publish', true, problem.slug);
      await finish('published', problem.id);
      return { problem, log };
    }
    await finish('rejected', null);
    return { problem: null, log };
  } catch (e) {
    note('error', false, (e as Error).message);
    await finish('error', null);
    return { problem: null, log };
  }
}

export interface PackResult {
  datasetKey: string;
  results: { level: Difficulty; tier: number; problem: { slug: string; title: string } | null; log: ForgeLog[] }[];
}

/**
 * Forge a graded pack for one segment (a dataset, or the newest dataset of a
 * domain such as "transport" or "engineering"): Easy → Medium → Hard, mapped
 * onto ladder tiers so each level genuinely needs more SQL than the last.
 */
export async function forgePack(opts: { datasetKey?: string; domain?: string; date: string; cadence?: Cadence; tiers?: number[] }): Promise<PackResult> {
  const all = [...datasets().values()];
  const ds =
    (opts.datasetKey && datasets().get(opts.datasetKey)) ||
    all.filter((d) => !opts.domain || d.domain === opts.domain).sort((a, b) => b.version.localeCompare(a.version))[0];
  if (!ds) throw new Error(`No dataset for ${opts.datasetKey ?? opts.domain}`);
  const tiers = opts.tiers ?? [2, 4, 5]; // Easy (aggregation) · Medium (composition) · Hard (analytics)
  const results: PackResult['results'] = [];
  for (const tier of tiers) {
    let out = await forgeProblem({ cadence: opts.cadence ?? 'core', date: opts.date, datasetKey: ds.key, tier });
    if (!out.problem) {
      // one more try on a different topic of the same tier before giving up on this level
      const used = out.log.find((l) => l.step === 'plan')?.detail?.split(' · ')[2];
      const alt = TIER_TOPICS[tier].find((t) => t !== used);
      if (alt) {
        const retry = await forgeProblem({ cadence: opts.cadence ?? 'core', date: opts.date, datasetKey: ds.key, tier, topic: alt });
        out = { problem: retry.problem, log: [...out.log, { step: 'retry-topic', ok: true, detail: alt, at: new Date().toISOString() }, ...retry.log] };
      }
    }
    results.push({ level: TIER_DIFFICULTY[tier], tier, problem: out.problem ? { slug: out.problem.slug, title: out.problem.title } : null, log: out.log });
  }
  return { datasetKey: ds.key, results };
}

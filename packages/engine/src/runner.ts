import { datasetToSql, makeVariant, schemaName, VARIANTS } from './dataset';
import { compareResults } from './judge';
import { guardQuery, hasTopLevelOrderBy, quoteIdent } from './sql';
import type {
  CaseVerdict,
  Dataset,
  ExecOutcome,
  JudgeReport,
  ResultSet,
  SqlError,
  TestCase,
  VariantKind,
} from './types';

/** Minimal surface of PGlite we rely on — lets the engine run in the browser, Node workers and tests. */
export interface PgLike {
  exec(sql: string): Promise<unknown>;
  query<T = unknown>(
    sql: string,
    params?: unknown[],
    options?: { rowMode?: 'array' | 'object' }
  ): Promise<{ rows: T[]; fields: { name: string; dataTypeID: number }[] }>;
}

export const MAX_ROWS = 1000;

const loaded = new WeakMap<object, Map<string, string>>();

/** Loads (once per instance + dataset version) the given dataset variants into their own schemas. */
export async function ensureDataset(
  db: PgLike,
  dataset: Dataset,
  kinds: VariantKind[] = ['sample'],
  { mirrors = false }: { mirrors?: boolean } = {}
): Promise<void> {
  let map = loaded.get(db);
  if (!map) loaded.set(db, (map = new Map()));
  for (const kind of kinds) {
    for (const mirror of mirrors ? [false, true] : [false]) {
      const schema = schemaName(dataset.key, kind, mirror);
      if (map.get(schema) === dataset.version) continue;
      let variant = makeVariant(dataset, kind);
      if (mirror) variant = { tables: variant.tables.map((t) => ({ ...t, rows: [...t.rows].reverse() })) };
      await db.exec(datasetToSql(variant, schema));
      map.set(schema, dataset.version);
    }
  }
}

export function toSqlError(e: unknown): SqlError {
  const err = e as { message?: string; code?: string; position?: string | number; hint?: string; detail?: string };
  return {
    message: err?.message ?? String(e),
    code: err?.code,
    position: err?.position !== undefined ? Number(err.position) : undefined,
    hint: err?.hint,
    detail: err?.detail,
    phase: 'postgres',
  };
}

/** Executes one guarded, read-only query inside `schema`. */
export async function runQuery(db: PgLike, schema: string, rawSql: string, maxRows = MAX_ROWS): Promise<ExecOutcome> {
  const t0 = now();
  const guard = guardQuery(rawSql);
  if (!guard.ok) return { ok: false, error: guard.error!, ms: 0 };
  try {
    await db.exec(`SET search_path TO ${quoteIdent(schema)}`);
    await db.exec('BEGIN READ ONLY');
    try {
      const res = await db.query<unknown[]>(guard.sql, [], { rowMode: 'array' });
      const truncated = res.rows.length > maxRows;
      const result: ResultSet = {
        fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        rows: truncated ? res.rows.slice(0, maxRows) : res.rows,
        truncated,
      };
      return { ok: true, result, ms: now() - t0 };
    } finally {
      await db.exec('ROLLBACK');
    }
  } catch (e) {
    return { ok: false, error: toSqlError(e), ms: now() - t0 };
  }
}

export interface PlanNode {
  'Node Type': string;
  'Total Cost': number;
  'Plan Rows': number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Relation Name'?: string;
  'Join Type'?: string;
  'Index Name'?: string;
  Filter?: string;
  'Hash Cond'?: string;
  'Sort Key'?: string[];
  'Group Key'?: string[];
  Plans?: PlanNode[];
  [k: string]: unknown;
}

/** Planner output for the query (optionally with ANALYZE timings). */
export async function explain(
  db: PgLike,
  schema: string,
  rawSql: string,
  analyze = false
): Promise<{ ok: true; plan: PlanNode; cost: number; executionMs?: number } | { ok: false; error: SqlError }> {
  const guard = guardQuery(rawSql);
  if (!guard.ok) return { ok: false, error: guard.error! };
  try {
    await db.exec(`SET search_path TO ${quoteIdent(schema)}`);
    await db.exec('BEGIN READ ONLY');
    try {
      const res = await db.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (${analyze ? 'ANALYZE, ' : ''}FORMAT JSON) ${guard.sql}`
      );
      const raw = res.rows[0]['QUERY PLAN'];
      const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { Plan: PlanNode; 'Execution Time'?: number }[];
      const plan = parsed[0].Plan;
      return { ok: true, plan, cost: plan['Total Cost'], executionMs: parsed[0]['Execution Time'] };
    } finally {
      await db.exec('ROLLBACK');
    }
  } catch (e) {
    return { ok: false, error: toSqlError(e) };
  }
}

export interface ForgeCheck {
  ok: boolean;
  reason?: string;
  testCases: TestCase[];
  orderMatters: boolean;
  sampleRowCount: number;
}

/**
 * Builds verified test cases for a reference solution. This is what makes
 * generated problems trustworthy: expected outputs are *computed* from the
 * reference on every variant, and the reference must be deterministic
 * (identical output on mirrored storage order) before a problem is accepted.
 */
export async function buildTestCases(db: PgLike, dataset: Dataset, referenceSql: string): Promise<ForgeCheck> {
  const kinds = VARIANTS.map((v) => v.kind);
  await ensureDataset(db, dataset, kinds, { mirrors: true });
  const orderMatters = hasTopLevelOrderBy(referenceSql);
  const testCases: TestCase[] = [];
  let sampleRowCount = 0;
  for (const v of VARIANTS) {
    const a = await runQuery(db, schemaName(dataset.key, v.kind), referenceSql, 5000);
    if (!a.ok) return { ok: false, reason: `Reference failed on ${v.label}: ${a.error.message}`, testCases, orderMatters, sampleRowCount };
    if (a.result.truncated) return { ok: false, reason: 'Reference returns too many rows (>5000).', testCases, orderMatters, sampleRowCount };
    const b = await runQuery(db, schemaName(dataset.key, v.kind, true), referenceSql, 5000);
    if (!b.ok) return { ok: false, reason: `Reference failed on mirrored ${v.label}: ${b.error.message}`, testCases, orderMatters, sampleRowCount };
    const same = compareResults(a.result, b.result, orderMatters);
    if (!same.equal) {
      return {
        ok: false,
        reason: `Reference is non-deterministic on "${v.label}" (${same.message}). Add tie-breakers to ORDER BY or remove LIMIT ambiguity.`,
        testCases,
        orderMatters,
        sampleRowCount,
      };
    }
    if (v.kind === 'sample') {
      sampleRowCount = a.result.rows.length;
      if (sampleRowCount === 0) return { ok: false, reason: 'Reference returns no rows on the sample data.', testCases, orderMatters, sampleRowCount };
    }
    testCases.push({ id: v.kind, label: v.label, hidden: v.hidden, variant: v.kind, expected: a.result });
  }
  return { ok: true, testCases, orderMatters, sampleRowCount };
}

/** Grades a learner query against every test case. */
export async function judge(
  db: PgLike,
  dataset: Dataset,
  testCases: TestCase[],
  userSql: string,
  orderMatters: boolean,
  referenceSql?: string
): Promise<JudgeReport> {
  const t0 = now();
  await ensureDataset(db, dataset, testCases.map((t) => t.variant));
  const cases: CaseVerdict[] = [];
  for (const tc of testCases) {
    const out = await runQuery(db, schemaName(dataset.key, tc.variant), userSql, 5000);
    if (!out.ok) {
      cases.push({
        caseId: tc.id,
        label: tc.label,
        hidden: tc.hidden,
        verdict: out.error.phase === 'guard' ? 'REJECTED' : 'RUNTIME_ERROR',
        ms: out.ms,
        message: out.error.message,
      });
      break; // an error will repeat on every case
    }
    const cmp = compareResults(tc.expected, out.result, orderMatters);
    cases.push({
      caseId: tc.id,
      label: tc.label,
      hidden: tc.hidden,
      verdict: cmp.equal ? 'ACCEPTED' : 'WRONG_ANSWER',
      ms: out.ms,
      message: cmp.message,
      diff: cmp.diff,
    });
    if (!cmp.equal) break; // stop at first failure, like DSA judges
  }
  const passed = cases.filter((c) => c.verdict === 'ACCEPTED').length;
  const failing = cases.find((c) => c.verdict !== 'ACCEPTED');
  const report: JudgeReport = {
    verdict: failing ? failing.verdict : 'ACCEPTED',
    passed,
    total: testCases.length,
    cases,
    ms: now() - t0,
    efficiency: null,
  };
  if (report.verdict === 'ACCEPTED' && referenceSql) {
    const schema = schemaName(dataset.key, 'sample');
    // sequential on purpose: each call runs its own transaction on the same connection
    const u = await explain(db, schema, userSql);
    const r = await explain(db, schema, referenceSql);
    if (u.ok && r.ok) {
      report.efficiency = { userCost: u.cost, referenceCost: r.cost, ratio: r.cost > 0 ? u.cost / r.cost : 1 };
    }
  }
  return report;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

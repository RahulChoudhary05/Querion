import { inferTier, type ForgeCheck } from '@querion/engine';
import { getDb } from '../db';
import { upsertProblem } from '../db/repo';
import { pool } from '../judge/pool';
import { CURATED } from './curated';
import { getDataset } from './registry';

/** Verifies and upserts every curated problem. Idempotent — safe to run on every boot. */
export async function seedCurated({ quiet = false } = {}) {
  let ok = 0;
  const failed: string[] = [];
  for (const p of CURATED) {
    const ds = getDataset(p.dataset);
    if (!ds) {
      failed.push(`${p.title}: dataset ${p.dataset} missing`);
      continue;
    }
    const check = await pool.run<ForgeCheck>({ type: 'forge', dataset: ds, sql: p.sql }, 30_000);
    if (!check.ok) {
      failed.push(`${p.title}: ${check.reason}`);
      continue;
    }
    let costBudget: number | null = null;
    if (p.budget) {
      const plan = await pool.run<{ ok: boolean; cost?: number }>({ type: 'explain', dataset: ds, sql: p.sql }, 30_000);
      if (plan.ok && plan.cost) costBudget = Math.round(plan.cost * p.budget * 100) / 100;
    }
    await upsertProblem({
      tier: p.tier ?? inferTier(p.topics),
      costBudget,
      title: p.title,
      difficulty: p.difficulty,
      datasetKey: p.dataset,
      topics: p.topics,
      statement: p.statement,
      outputColumns: check.testCases[0].expected.fields.map((f) => f.name),
      referenceSql: p.sql,
      hints: p.hints,
      explanation: p.explanation,
      cadence: 'core',
      origin: 'curated',
      orderMatters: check.orderMatters,
      testCases: check.testCases,
      quality: { verifiedAt: new Date().toISOString(), variants: check.testCases.map((t) => ({ id: t.id, rows: t.expected.rows.length })) },
    });
    ok++;
    if (!quiet) console.log(`  ✓ ${p.title}`);
  }
  if (failed.length) console.warn(`  ✗ ${failed.length} curated problem(s) failed:\n    ${failed.join('\n    ')}`);
  return { ok, failed };
}

/** Seeds only when the problem bank is empty (first boot). */
export async function seedIfEmpty() {
  const db = await getDb();
  const res = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM problems WHERE origin = 'curated'");
  if (res.rows[0].n >= CURATED.length) return;
  console.log(`🌱 Verifying & seeding curated problems (${res.rows[0].n}/${CURATED.length} present)…`);
  const r = await seedCurated({ quiet: true });
  console.log(`🌱 Seeded ${r.ok} problems.`);
}

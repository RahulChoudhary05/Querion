/**
 * Nebula CLI.
 *   pnpm forge                       → run today's release (daily + weekly + monthly catch-up)
 *   pnpm forge -- --one [--dataset transit] [--difficulty Hard] [--topic "Window Functions"]
 * Used by the GitHub Actions cron as well as locally.
 */
import { parseArgs } from 'node:util';
import type { Difficulty } from '@querion/engine';
import { aiEnabled } from '../ai/llm';
import { getDb } from '../db';
import { pool } from '../judge/pool';
import { forgePack, forgeProblem } from '../nebula/forge';
import { reloadDatasets } from '../nebula/registry';
import { discoverModels } from '../ai/llm';
import { catchUp, today } from '../nebula/scheduler';
import { seedIfEmpty } from '../nebula/seed';

const { values } = parseArgs({
  options: { one: { type: 'boolean' }, pack: { type: 'boolean' }, dataset: { type: 'string' }, domain: { type: 'string' }, difficulty: { type: 'string' }, topic: { type: 'string' }, tier: { type: 'string' } },
});

await reloadDatasets();
console.log('AI models:', (await discoverModels()).join(' → ') || 'none');
await seedIfEmpty();
if (values.pack) {
  const r = await forgePack({ datasetKey: values.dataset, domain: values.domain, date: today() });
  console.log(`
Segment pack on ${r.datasetKey}`);
  for (const x of r.results) {
    console.log(`
── ${x.level} (tier ${x.tier}) ──`);
    for (const l of x.log) console.log(`${l.ok ? '✓' : '✗'} ${l.step.padEnd(14)} ${l.detail ?? ''}`);
    console.log(x.problem ? `→ Published: ${x.problem.title} (/p/${x.problem.slug})` : '→ Rejected');
  }
} else if (values.one) {
  if (!aiEnabled()) {
    console.error('Set GROQ_API_KEY or GEMINI_API_KEY to forge problems.');
    process.exit(1);
  }
  const out = await forgeProblem({ cadence: 'core', date: today(), datasetKey: values.dataset, difficulty: values.difficulty as Difficulty | undefined, topic: values.topic, tier: values.tier ? Number(values.tier) : undefined });
  for (const l of out.log) console.log(`${l.ok ? '✓' : '✗'} ${l.step.padEnd(14)} ${l.detail ?? ''}`);
  console.log(out.problem ? `\nPublished: ${out.problem.title} (/p/${out.problem.slug})` : '\nRejected.');
} else {
  await catchUp();
  console.log('Release complete.');
}
await pool.close();
await (await getDb()).close();
process.exit(0);

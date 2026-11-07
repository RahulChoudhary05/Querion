/**
 * Nebula job runner — used by GitHub Actions, n8n, or any cron.
 *   tsx src/cli/nebula.ts daily    → today's Daily Orbit
 *   tsx src/cli/nebula.ts weekly   → full weekly agent (insights → Kaggle scout → ladder → digest) for next Monday
 *   tsx src/cli/nebula.ts scout    → only scout & ingest a fresh Kaggle dataset
 */
import { getDb } from '../db';
import { pool } from '../judge/pool';
import { reloadDatasets } from '../nebula/registry';
import { ensureDaily, mondayOf, nextMonday, runWeekly, today } from '../nebula/scheduler';
import { scout } from '../nebula/scout';
import { seedIfEmpty } from '../nebula/seed';

const job = process.argv[2] ?? 'daily';
await reloadDatasets();
await seedIfEmpty();

if (job === 'daily') await ensureDaily();
else if (job === 'weekly') {
  // Sunday runs prepare next week; manual runs mid-week fill the current week.
  const d = new Date().getUTCDay();
  await runWeekly(d === 0 ? nextMonday(today()) : mondayOf(today()));
} else if (job === 'scout') {
  // optional 2nd arg: domain (transport | automotive | engineering | commerce | health | finance | sports | media)
  const r = await scout({ week: mondayOf(today()), domain: process.argv[3] as never });
  for (const l of r.log) console.log(`${l.ok ? '✓' : '✗'} ${l.step}: ${l.detail ?? ''}`);
  console.log(r.dataset ? `Ingested ${r.dataset.key}` : 'No dataset ingested.');
} else {
  console.error(`Unknown job "${job}" (daily | weekly | scout)`);
  process.exitCode = 1;
}

await pool.close();
await (await getDb()).close();

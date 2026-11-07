/** pnpm kaggle:sync [-- --all] — download & ingest Kaggle datasets from data/kaggle-catalog.json. */
import { pool } from '../judge/pool';
import { kaggleSync } from '../nebula/kaggleSync';

const all = process.argv.includes('--all');
try {
  const r = await kaggleSync({ all });
  console.log(`Added: ${r.added.join(', ') || '(none)'}`);
  if (r.errors.length) console.warn(`Errors:\n  ${r.errors.join('\n  ')}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
await pool.close();

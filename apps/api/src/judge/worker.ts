/**
 * Judge worker: owns one in-memory PGlite instance with dataset variants cached
 * as schemas. Learner SQL only ever runs here — inside a READ ONLY transaction,
 * on a throwaway database that holds nothing but public practice data. If a
 * query runs away, the parent terminates this thread and spawns a fresh one.
 */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildTestCases, ensureDataset, explain, judge, runQuery, schemaName } from '@querion/engine';
import { JUDGE_SNAPSHOT } from '../paths';
import type { JudgeJob } from './pool';

// Memory matters: free hosts give 512 MB. A cold PGlite boot runs initdb and peaks near 1 GB;
// booting from a pre-initialised snapshot (pnpm judge:snapshot) with V8's --liftoff-only
// (set by pool.ts) peaks around 300 MB. Practice datasets are small, so lean buffers are plenty.
// startParams replaces PGlite's defaults, so those are repeated here.
function snapshot(): Blob | undefined {
  try {
    return fs.existsSync(JUDGE_SNAPSHOT) ? new Blob([fs.readFileSync(JUDGE_SNAPSHOT)], { type: 'application/x-gzip' }) : undefined;
  } catch {
    return undefined;
  }
}

const options = {
  startParams: [
    '--single', '-F', '-O', '-j',
    '-c', 'search_path=public',
    '-c', 'exit_on_error=false',
    '-c', 'log_checkpoints=false',
    '-c', 'max_worker_processes=0',
    '-c', 'max_parallel_workers=0',
    '-c', 'max_parallel_workers_per_gather=0',
    '-c', 'max_parallel_maintenance_workers=0',
    '-c', 'io_method=sync',
    '-c', 'shared_buffers=16MB',
    '-c', 'temp_buffers=4MB',
    '-c', 'work_mem=4MB',
    '-c', 'maintenance_work_mem=16MB',
  ],
};

const dbReady = (async () => {
  const loadDataDir = snapshot();
  if (loadDataDir) {
    try {
      return await PGlite.create({ ...options, loadDataDir });
    } catch (e) {
      // e.g. snapshot from another PGlite version — fall back to a normal (heavier) boot
      console.warn('Judge snapshot unusable, booting fresh:', (e as Error).message, '— run `pnpm judge:snapshot`');
    }
  }
  return PGlite.create(options);
})();

async function handle(job: JudgeJob): Promise<unknown> {
  const db = await dbReady;
  if (job.type === 'ping') return { ok: true };
  const ds = job.dataset;
  switch (job.type) {
    case 'judge':
      return judge(db, ds, job.testCases, job.sql, job.orderMatters, job.referenceSql);
    case 'forge':
      return buildTestCases(db, ds, job.sql);
    case 'run': {
      await ensureDataset(db, ds, ['sample']);
      return runQuery(db, schemaName(ds.key, 'sample'), job.sql);
    }
    case 'explain': {
      await ensureDataset(db, ds, ['sample']);
      return explain(db, schemaName(ds.key, 'sample'), job.sql, true);
    }
  }
}

// Runs as a child process (see pool.ts): talk to the API over IPC, and exit with it.
const reply = (msg: object) => process.send?.(msg);
process.on('message', async (msg: { id: number; job: JudgeJob }) => {
  try {
    const result = await handle(msg.job);
    reply({ id: msg.id, ok: true, result });
  } catch (e) {
    reply({ id: msg.id, ok: false, error: (e as Error).message });
  }
});
process.on('disconnect', () => process.exit(0));
reply({ ready: true });

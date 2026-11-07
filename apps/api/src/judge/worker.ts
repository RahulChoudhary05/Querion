/**
 * Judge worker: owns one in-memory PGlite instance with dataset variants cached
 * as schemas. Learner SQL only ever runs here — inside a READ ONLY transaction,
 * on a throwaway database that holds nothing but public practice data. If a
 * query runs away, the parent terminates this thread and spawns a fresh one.
 */
import { parentPort } from 'node:worker_threads';
import { PGlite } from '@electric-sql/pglite';
import { buildTestCases, ensureDataset, explain, judge, runQuery, schemaName } from '@querion/engine';
import type { JudgeJob } from './pool';

const dbReady = PGlite.create();

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

parentPort!.on('message', async (msg: { id: number; job: JudgeJob }) => {
  try {
    const result = await handle(msg.job);
    parentPort!.postMessage({ id: msg.id, ok: true, result });
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: (e as Error).message });
  }
});
parentPort!.postMessage({ ready: true });

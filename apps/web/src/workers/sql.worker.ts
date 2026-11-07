/// <reference lib="webworker" />
/**
 * In-browser PostgreSQL (PGlite / WASM). "Run" executes here — zero latency,
 * zero server cost, works offline. The main thread terminates this worker if a
 * query runs too long and spins up a fresh one.
 */
import { PGlite } from '@electric-sql/pglite';
import { ensureDataset, explain, runQuery, schemaName, type Dataset } from '@querion/engine';

const ready = PGlite.create();
const loaded = new Map<string, Dataset>();

type Msg =
  | { id: number; type: 'load'; dataset: Dataset }
  | { id: number; type: 'run'; key: string; sql: string }
  | { id: number; type: 'explain'; key: string; sql: string };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    const db = await ready;
    if (m.type === 'load') {
      await ensureDataset(db, m.dataset, ['sample']);
      loaded.set(m.dataset.key, m.dataset);
      postMessage({ id: m.id, ok: true, result: true });
      return;
    }
    if (!loaded.has(m.key)) throw new Error('Dataset not loaded');
    const schema = schemaName(m.key, 'sample');
    const result = m.type === 'run' ? await runQuery(db, schema, m.sql) : await explain(db, schema, m.sql, true);
    postMessage({ id: m.id, ok: true, result });
  } catch (err) {
    postMessage({ id: m.id, ok: false, error: (err as Error).message });
  }
};

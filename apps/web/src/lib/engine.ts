import type { Dataset, ExecOutcome, PlanNode, SqlError } from '@querion/engine';

const TIMEOUT_MS = 6000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number };

/** Client for the in-browser Postgres worker, with hard timeouts + automatic recovery. */
class BrowserEngine {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private datasets = new Map<string, Dataset>();
  private loadedIn = new Set<string>();

  private spawn() {
    this.worker = new Worker(new URL('../workers/sql.worker.ts', import.meta.url), { type: 'module' });
    this.loadedIn.clear();
    this.worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
  }

  private call<T>(msg: Record<string, unknown>, timeout: number): Promise<T> {
    if (!this.worker) this.spawn();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        // a runaway query: kill the worker, start fresh
        this.worker?.terminate();
        this.worker = null;
        for (const p of this.pending.values()) p.reject(new Error('Engine restarted'));
        this.pending.clear();
        reject(Object.assign(new Error('timeout'), { timeout: true }));
      }, timeout);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.worker!.postMessage({ ...msg, id });
    });
  }

  async load(dataset: Dataset) {
    this.datasets.set(dataset.key, dataset);
    if (this.loadedIn.has(dataset.key) && this.worker) return;
    await this.call({ type: 'load', dataset }, 60_000);
    this.loadedIn.add(dataset.key);
  }

  private async ensure(key: string) {
    if (!this.loadedIn.has(key) || !this.worker) {
      const ds = this.datasets.get(key);
      if (!ds) throw new Error('Dataset not loaded yet');
      await this.load(ds);
    }
  }

  async run(key: string, sql: string): Promise<ExecOutcome> {
    await this.ensure(key);
    try {
      return await this.call<ExecOutcome>({ type: 'run', key, sql }, TIMEOUT_MS);
    } catch (e) {
      if ((e as { timeout?: boolean }).timeout) {
        const error: SqlError = { message: `Stopped after ${TIMEOUT_MS / 1000}s`, phase: 'timeout' };
        return { ok: false, error, ms: TIMEOUT_MS };
      }
      throw e;
    }
  }

  async explain(key: string, sql: string) {
    await this.ensure(key);
    return this.call<{ ok: true; plan: PlanNode; cost: number; executionMs?: number } | { ok: false; error: SqlError }>({ type: 'explain', key, sql }, TIMEOUT_MS);
  }
}

export const engine = new BrowserEngine();

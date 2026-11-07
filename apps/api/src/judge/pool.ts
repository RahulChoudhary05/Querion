import { Worker } from 'node:worker_threads';
import type { Dataset, TestCase } from '@querion/engine';
import { env } from '../env';

export type JudgeJob =
  | { type: 'judge'; dataset: Dataset; testCases: TestCase[]; sql: string; orderMatters: boolean; referenceSql?: string }
  | { type: 'forge'; dataset: Dataset; sql: string }
  | { type: 'run'; dataset: Dataset; sql: string }
  | { type: 'explain'; dataset: Dataset; sql: string }
  | { type: 'ping' };

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Execution exceeded ${ms} ms`);
  }
}

/**
 * Workers must load TypeScript the same way the parent does (tsx registers via
 * --import / --require), but many other process flags (test runner, NODE_OPTIONS,
 * --watch …) are illegal inside workers. Forward only module-loader flags.
 */
function loaderArgs(): string[] {
  const out: string[] = [];
  const argv = process.execArgv;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/^--(import|require|loader|experimental-loader)=/.test(a)) out.push(a);
    else if (/^(--import|--require|-r|--loader|--experimental-loader)$/.test(a) && argv[i + 1]) out.push(a, argv[++i]);
  }
  return out;
}

interface Pending {
  id: number;
  job: JudgeJob;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timeoutMs: number;
}

interface Slot {
  worker: Worker;
  busy: Pending | null;
  timer: NodeJS.Timeout | null;
  /** Fresh workers pay PGlite boot + dataset load on their first job. */
  warmed: boolean;
}

/** Fixed-size pool of judge workers with per-job hard timeouts (terminate + respawn). */
class JudgePool {
  private slots: Slot[] = [];
  private queue: Pending[] = [];
  private seq = 0;

  constructor(private size: number) {}

  private spawn(): Slot {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { execArgv: loaderArgs() });
    const slot: Slot = { worker, busy: null, timer: null, warmed: false };
    worker.on('message', (msg: { id?: number; ok?: boolean; result?: unknown; error?: string; ready?: boolean }) => {
      if (msg.ready || !slot.busy || msg.id !== slot.busy.id) return;
      const p = slot.busy;
      this.release(slot);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    worker.on('error', (err) => {
      const p = slot.busy;
      this.replace(slot);
      p?.reject(err);
    });
    return slot;
  }

  private ensure() {
    while (this.slots.length < this.size) this.slots.push(this.spawn());
  }

  private release(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.busy = null;
    this.pump();
  }

  private replace(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.worker.removeAllListeners();
    void slot.worker.terminate();
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots[i] = this.spawn();
    this.pump();
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.busy || !this.queue.length) continue;
      const p = this.queue.shift()!;
      slot.busy = p;
      const budget = p.timeoutMs + (slot.warmed ? 0 : 20_000);
      slot.warmed = true;
      slot.timer = setTimeout(() => {
        if (slot.busy !== p) return;
        slot.busy = null;
        this.replace(slot);
        p.reject(new TimeoutError(p.timeoutMs));
      }, budget);
      slot.worker.postMessage({ id: p.id, job: p.job });
    }
  }

  run<T>(job: JudgeJob, timeoutMs = env.JUDGE_TIMEOUT_MS): Promise<T> {
    this.ensure();
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id: ++this.seq, job, resolve: resolve as (v: unknown) => void, reject, timeoutMs });
      this.pump();
    });
  }

  /** Boots every worker so the first learner submission is fast. */
  warm() {
    this.ensure();
    for (let i = 0; i < this.size; i++) void this.run({ type: 'ping' }).catch(() => {});
  }

  async close() {
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }
}

export const pool = new JudgePool(env.JUDGE_WORKERS);

import { type ChildProcess, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
 * Judge workers are child PROCESSES, not worker threads: booting PGlite (Postgres-in-WASM)
 * inside a worker thread spikes to ~1 GB RSS, while a child process peaks at ~350 MB —
 * the difference between fitting a 512 MB free-tier instance or getting OOM-killed.
 *
 * Children must load TypeScript the same way the parent does (tsx registers via
 * --import / --require), but other flags (test runner, --watch …) must not be inherited.
 * Forward only module-loader flags.
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
  worker: ChildProcess;
  busy: Pending | null;
  timer: NodeJS.Timeout | null;
  /** Fresh workers pay PGlite boot + dataset load on their first job. */
  warmed: boolean;
  /** Jobs handled; each worker caches every dataset it touches, so it is recycled after a while. */
  jobs: number;
}

/** Recycle a worker after this many jobs so its cached datasets can't grow without bound (512 MB hosts). */
const RECYCLE_AFTER = Math.max(10, Number(process.env.JUDGE_RECYCLE_JOBS) || 200);

/** Fixed-size pool of judge workers with per-job hard timeouts (terminate + respawn). */
class JudgePool {
  private slots: Slot[] = [];
  private queue: Pending[] = [];
  private seq = 0;

  constructor(private size: number) {}

  private spawn(): Slot {
    const worker = fork(fileURLToPath(new URL('./worker.ts', import.meta.url)), [], {
      // --liftoff-only: skip V8's optimising WASM compiler for the 9 MB Postgres binary
      // (halves boot memory; queries on small practice datasets stay fast)
      execArgv: [...loaderArgs(), '--liftoff-only'],
      serialization: 'advanced', // structured clone, like worker threads (Dates, BigInts survive)
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const slot: Slot = { worker, busy: null, timer: null, warmed: false, jobs: 0 };
    worker.on('message', (msg: { id?: number; ok?: boolean; result?: unknown; error?: string; ready?: boolean }) => {
      if (msg.ready || !slot.busy || msg.id !== slot.busy.id) return;
      const p = slot.busy;
      if (++slot.jobs >= RECYCLE_AFTER) {
        slot.busy = null;
        this.replace(slot);
      } else this.release(slot);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    const crashed = (err: Error) => {
      if (!this.slots.includes(slot)) return; // already replaced / recycled
      const p = slot.busy;
      slot.busy = null;
      this.replace(slot);
      p?.reject(err);
    };
    worker.on('error', crashed);
    worker.on('exit', (code, signal) => crashed(new Error(`Judge process exited (${signal ?? code})`)));
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
    kill(slot.worker);
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
      slot.worker.send({ id: p.id, job: p.job });
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

  /** Waits for in-flight jobs, then swaps every worker for a fresh one (frees all cached datasets). */
  async recycle() {
    while (this.slots.some((s) => s.busy) || this.queue.length) await new Promise((r) => setTimeout(r, 50));
    const old = this.slots;
    this.slots = [];
    await Promise.all(old.map((s) => kill(s.worker)));
  }

  async close() {
    const old = this.slots;
    this.slots = [];
    await Promise.all(old.map((s) => kill(s.worker)));
  }
}

/** Hard-kills a judge process and resolves once it has exited (its memory is back). */
function kill(w: ChildProcess): Promise<void> {
  w.removeAllListeners();
  if (w.exitCode !== null || w.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    w.once('exit', () => resolve());
    w.kill('SIGKILL');
  });
}

export const pool = new JudgePool(env.JUDGE_WORKERS);

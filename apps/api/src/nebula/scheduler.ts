import cron from 'node-cron';
import { hashString, type Cadence, type Difficulty } from '@querion/engine';
import { aiAvailable } from '../ai/llm';
import { getDb } from '../db';
import { addSchedule, recentScheduledIds, scheduleFor } from '../db/repo';
import { env } from '../env';
import { sendWeeklyDigest } from '../services/mail';
import { forgeProblem, type ForgeOptions } from './forge';
import { computeInsights, storeInsights } from './insights';
import { datasets } from './registry';
import { scout } from './scout';

/**
 * Release calendar
 *   daily    00:05 UTC  — one fresh problem ("Daily Orbit")
 *   weekly   Sun 18:00  — the Weekly Constellation for the coming Monday:
 *                          insights → Kaggle Scout (fresh dataset) → a Tier 1→6 ladder on it
 *                          + "stepping-stone" problems for last week's weakest topics → email digest
 *   monthly  1st        — one Architect-tier challenge
 * When AI is unavailable or a forge is rejected, an unused curated problem is
 * scheduled instead, so the calendar never has holes.
 */

export const today = () => new Date().toISOString().slice(0, 10);

export function mondayOf(date: string) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function nextMonday(date: string) {
  const d = new Date(mondayOf(date) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}
export const monthStart = (date: string) => date.slice(0, 8) + '01';

const running = new Set<string>();
async function once(key: string, fn: () => Promise<void>) {
  if (running.has(key)) return;
  running.add(key);
  try {
    await fn();
  } finally {
    running.delete(key);
  }
}

async function fallbackPick(day: string, cadence: Cadence, difficulty?: Difficulty, tier?: number): Promise<number | null> {
  const db = await getDb();
  const recent = await recentScheduledIds(60);
  const res = await db.query<{ id: number }>(
    `SELECT id FROM problems WHERE active AND ($1::text IS NULL OR difficulty = $1) AND ($2::int IS NULL OR tier = $2) ORDER BY id`,
    [difficulty ?? null, tier ?? null]
  );
  const fresh = res.rows.map((r) => r.id).filter((id) => !recent.includes(id));
  const pool = fresh.length ? fresh : res.rows.map((r) => r.id);
  return pool.length ? pool[hashString(`${day}:${cadence}:${difficulty}:${tier}`) % pool.length] : null;
}

async function release(day: string, opts: Omit<ForgeOptions, 'date' | 'cadence'> & { cadence: Cadence }) {
  if (aiAvailable()) {
    const { problem, log } = await forgeProblem({ ...opts, date: day });
    if (problem) {
      await addSchedule(day, opts.cadence, problem.id);
      console.log(`✨ Nebula forged ${opts.cadence} "${problem.title}" (${problem.dataset_key}, tier ${problem.tier})`);
      return problem.id;
    }
    console.warn(`⚠️  Forge rejected (${opts.cadence} ${day}): ${log.filter((l) => !l.ok).map((l) => l.detail).join(' | ').slice(0, 240)}`);
  }
  const id = await fallbackPick(day, opts.cadence, opts.difficulty, opts.tier);
  if (id) await addSchedule(day, opts.cadence, id);
  return id;
}

export async function ensureDaily(day = today()) {
  await once(`daily:${day}`, async () => {
    if ((await scheduleFor(day)).some((s) => s.cadence === 'daily')) return;
    const tier = 1 + (hashString(day) % 5); // dailies rotate tiers 1–5
    await release(day, { cadence: 'daily', tier });
  });
}

/** The full weekly agent run. `week` is the Monday the pack is published for. */
export async function runWeekly(week: string, { full = true }: { full?: boolean } = {}) {
  await once(`weekly:${week}`, async () => {
    const already = (await scheduleFor(week)).filter((s) => s.cadence === 'weekly').length;
    if (already >= 3) return;
    console.log(`🌌 Weekly Constellation for ${week} — starting`);

    // 1. learn from last week
    const insights = await computeInsights(week);
    await storeInsights(insights);

    // 2. fresh data from Kaggle
    let datasetKey: string | undefined;
    if (full && env.KAGGLE_USERNAME && env.KAGGLE_KEY) {
      try {
        const res = await scout({ week, domain: insights.domains[0]?.domain as never });
        for (const l of res.log) console.log(`   scout ${l.ok ? '✓' : '✗'} ${l.step}: ${l.detail ?? ''}`);
        datasetKey = res.dataset?.key;
      } catch (e) {
        console.warn('   scout failed:', (e as Error).message);
      }
    }
    if (!datasetKey) {
      // least-covered dataset gets the ladder
      const db = await getDb();
      const counts = await db.query<{ dataset_key: string; n: number }>('SELECT dataset_key, COUNT(*)::int AS n FROM problems GROUP BY 1');
      const n = new Map(counts.rows.map((r) => [r.dataset_key, r.n]));
      datasetKey = [...datasets().keys()].sort((a, b) => (n.get(a) ?? 0) - (n.get(b) ?? 0))[0];
    }

    // 3. a full ladder on the fresh dataset (quality over quantity: 6 problems, each verified + blind-solved)
    const tiers = full ? [1, 2, 3, 4, 5, 6] : [2, 4, 5];
    for (const tier of tiers) await release(week, { cadence: 'weekly', tier, datasetKey });

    // 4. stepping stones for the weakest topics
    for (const topic of insights.weakTopics.slice(0, 2)) {
      const rate = insights.topics.find((t) => t.topic === topic)?.solveRate ?? 0;
      await release(week, {
        cadence: 'weekly',
        topic,
        difficulty: 'Medium',
        focus: `Only ${Math.round(rate * 100)}% of learners solved "${topic}" problems last week. Make a stepping-stone problem that isolates the core idea of ${topic} with one clear twist, so learners can bridge to harder ones.`,
      });
    }

    // 5. tell people
    const mail = await sendWeeklyDigest(week).catch(() => ({ sent: 0 }));
    console.log(`🌌 Weekly Constellation ${week} ready (${mail.sent} emails)`);
  });
}

export async function ensureMonthly(day = today()) {
  const first = monthStart(day);
  await once(`monthly:${first}`, async () => {
    if ((await scheduleFor(first)).some((s) => s.cadence === 'monthly')) return;
    await release(first, { cadence: 'monthly', tier: 6 });
  });
}

/** Called after cold starts: make sure the current day/week/month have content. */
export async function catchUp() {
  await ensureDaily();
  const week = mondayOf(today());
  if ((await scheduleFor(week)).filter((s) => s.cadence === 'weekly').length < 3) await runWeekly(week, { full: false });
  await ensureMonthly();
}

export function startScheduler() {
  if (!env.SCHEDULER_ENABLED) return;
  const safe = (fn: () => Promise<unknown>) => () => void fn().catch((e) => console.error('scheduler', e));
  cron.schedule('5 0 * * *', safe(() => ensureDaily()), { timezone: 'UTC' });
  cron.schedule('0 18 * * 0', safe(() => runWeekly(nextMonday(today()))), { timezone: 'UTC' });
  cron.schedule('10 0 1 * *', safe(() => ensureMonthly()), { timezone: 'UTC' });
  setTimeout(safe(catchUp), 4000);
  console.log('🗓️  Nebula scheduler on — daily 00:05 · weekly agent Sun 18:00 · monthly 1st (UTC)');
}

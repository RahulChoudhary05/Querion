import type { Dataset, Difficulty, JudgeReport, ResultSet, ExecOutcome, SqlError } from '@querion/engine';
import type { ErrorInsight } from '@querion/engine';
import { useApp } from './store';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** Called when the server says the session is gone (expired / revoked elsewhere). */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

/**
 * Auth is an httpOnly session cookie — JavaScript never sees a token.
 * `credentials: 'include'` sends it; the X-Querion-CSRF header proves the
 * request came from our own code (cross-site pages can't add it).
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { clientId } = useApp.getState();
  const headers = new Headers(init.headers);
  headers.set('X-Client-Id', clientId);
  headers.set('X-Querion-CSRF', '1');
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers, credentials: 'include', body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  } catch {
    throw new ApiError('Network error — is the Querion API running?', 0);
  }
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? res.statusText, res.status);
  return data as T;
}

// ───────── types ─────────
export interface Domain {
  key: string;
  label: string;
  blurb: string;
  hue: number;
  datasets: string[];
  problems: number;
}
export interface Tier {
  tier: number;
  name: string;
  blurb: string;
}
export interface Meta {
  ai: { enabled: boolean; providers: { name: string; model: string }[] };
  domains: Domain[];
  datasets: { key: string; name: string; domain: string; source: 'synthetic' | 'kaggle' }[];
  topics: string[];
  tiers: Tier[];
  counts: { problems: number; forged: number; datasets: number; rows: number };
}
export interface ProblemListItem {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  dataset_key: string;
  datasetName: string;
  domain: string;
  topics: string[];
  cadence: string;
  origin: 'curated' | 'ai';
  forged_for: string | null;
  tier: number;
  cost_budget: number | null;
  solved_by: number;
  attempts: number;
  status: 'solved' | 'attempted' | null;
}
export interface Problem {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  datasetKey: string;
  topics: string[];
  statement: string;
  outputColumns: string[];
  orderMatters: boolean;
  tier: number;
  costBudget: number | null;
  cadence: string;
  origin: 'curated' | 'ai';
  forgedFor: string | null;
  quality: { blindSolve: string | null; generator: string | null; verifiedAt: string | null };
  tests: { id: string; label: string; hidden: boolean }[];
  sampleExpected: (ResultSet & { total: number }) | null;
  solved: boolean;
  explanation: string | null;
}
export interface DatasetSummary {
  key: string;
  name: string;
  domain: string;
  tagline: string;
  description: string;
  source: Dataset['source'];
  version: string;
  tables: { name: string; description: string; rowCount: number; columns: Dataset['tables'][number]['columns'] }[];
}
export interface Submission {
  id: number;
  sql: string;
  verdict: string;
  passed: number;
  total: number;
  runtime_ms: number;
  plan_cost: number | null;
  created_at: string;
}
export interface TodayItem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  tier: number;
  datasetKey: string;
  datasetName?: string;
  topics: string[];
  origin: string;
  status: 'solved' | 'attempted' | null;
}
export interface Today {
  day: string;
  daily: TodayItem | null;
  weekly: TodayItem[];
  monthly: TodayItem[];
  nextReleaseAt: string;
}
export interface Rec {
  kind: 'continue' | 'strengthen' | 'fresh' | 'start';
  reason: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  tier: number;
  datasetName: string;
}
export interface Stats {
  solved: Record<string, number>;
  totals: Record<string, number>;
  heatmap: { day: string; n: number }[];
  topics: { topic: string; n: number }[];
  streak: number;
}
export interface Track {
  dataset: DatasetSummary;
  tiers: (Tier & { problems: { slug: string; title: string; difficulty: Difficulty; topics: string[]; origin: string; status: string | null }[] })[];
}
export interface Insights {
  week: string;
  activeLearners: number;
  submissions: number;
  acceptance: number;
  topics: { topic: string; attempts: number; learners: number; solveRate: number }[];
  weakTopics: string[];
  hardest: { slug: string; title: string; attempts: number; solveRate: number }[];
}
export interface Review {
  verdict_summary: string;
  strengths: string[];
  improvements: string[];
  complexity: string;
  alternative_approach?: string | null;
  alternative_sql?: string | null;
  provider: string;
}

export type { JudgeReport, ResultSet, ExecOutcome, SqlError, ErrorInsight, Dataset };

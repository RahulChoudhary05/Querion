import path from 'node:path';
import { z } from 'zod';
import { PGlite } from '@electric-sql/pglite';
import { datasetToSql, describeSchema, hashString, quoteIdent, type Cell, type ColumnDef, type Dataset, type DomainKey, type TableDef } from '@querion/engine';
import { aiAvailable, AiUnavailableError, chatJson, type ChatMessage } from '../ai/llm';
import { env } from '../env';
import { ingestCsvFiles } from './kaggleSync';
import { datasets, storeDataset } from './registry';

/**
 * KAGGLE SCOUT — the weekly data agent.
 *
 *   search Kaggle (rotating domain) → filter (open license, size, usability, novelty)
 *   → LLM ranks candidates by SQL-teachability
 *   → download winner → LLM designs a normalised relational schema as SQL over the raw CSV
 *   → schema is EXECUTED on PGlite and validated (non-empty, PK unique, FKs resolve)
 *   → failures go back to the LLM for repair → dataset stored in the DB catalog
 *
 * Without AI it degrades to a typed single-table ingest of the best candidate.
 */

const API = 'https://www.kaggle.com/api/v1';
const OPEN = /cc0|public domain|cc-by|cc by|odbl|attribution|mit|apache|open data|database contents/i;

const DOMAIN_QUERIES: Record<Exclude<DomainKey, 'general'>, string[]> = {
  transport: ['public transport', 'bus ridership', 'flight delays', 'bike sharing', 'taxi trips', 'railway'],
  automotive: ['car sales', 'used cars', 'vehicle registrations', 'electric vehicles', 'car insurance claims'],
  engineering: ['github repositories', 'software bugs', 'stack overflow', 'it incidents', 'cloud costs'],
  commerce: ['ecommerce orders', 'retail sales', 'supermarket sales', 'online shopping', 'restaurant orders'],
  health: ['hospital admissions', 'healthcare appointments', 'clinical trials', 'pharmacy sales'],
  finance: ['bank transactions', 'loan default', 'credit card', 'stock prices', 'insurance'],
  sports: ['football matches', 'cricket ipl', 'nba games', 'formula 1', 'tennis matches'],
  media: ['movies ratings', 'spotify tracks', 'books ratings', 'anime', 'video games sales'],
};

interface Candidate {
  ref: string;
  title: string;
  subtitle?: string;
  licenseName?: string;
  totalBytes?: number;
  usabilityRating?: number;
  voteCount?: number;
}

export interface ScoutLog {
  step: string;
  ok: boolean;
  detail?: string;
}

function auth() {
  if (!env.KAGGLE_USERNAME || !env.KAGGLE_KEY) throw new Error('KAGGLE_USERNAME / KAGGLE_KEY not set');
  return 'Basic ' + Buffer.from(`${env.KAGGLE_USERNAME}:${env.KAGGLE_KEY}`).toString('base64');
}

async function search(query: string): Promise<Candidate[]> {
  const url = `${API}/datasets/list?search=${encodeURIComponent(query)}&sortBy=votes&filetype=csv&maxSize=30000000&page=1`;
  const res = await fetch(url, { headers: { Authorization: auth() }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Kaggle search "${query}" failed: ${res.status}`);
  return (await res.json()) as Candidate[];
}

const keyFor = (ref: string) =>
  'k_' + ref.split('/')[1].toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 22).replace(/^_+|_+$/g, '');

function pickDomain(week: string): Exclude<DomainKey, 'general'> {
  const keys = Object.keys(DOMAIN_QUERIES) as Exclude<DomainKey, 'general'>[];
  return keys[hashString(week) % keys.length];
}

// ───────── LLM contracts ─────────
const Ranking = z.object({
  ranking: z.array(z.object({ ref: z.string(), score: z.number(), why: z.string() })).min(1),
});

const Design = z.object({
  name: z.string().min(3).max(48),
  tagline: z.string().min(10).max(140),
  description: z.string().min(40).max(700),
  tables: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
        description: z.string(),
        sql: z.string().min(10),
        primary_key: z.array(z.string()).default([]),
        references: z.array(z.object({ column: z.string(), table: z.string(), target_column: z.string() })).default([]),
        notes: z.record(z.string(), z.string()).default({}),
      })
    )
    .min(2)
    .max(6),
});
type Design = z.infer<typeof Design>;

// ───────── materialisation ─────────
const TYPE_MAP: Record<string, string> = {
  integer: 'integer',
  bigint: 'bigint',
  smallint: 'integer',
  numeric: 'numeric',
  'double precision': 'numeric',
  real: 'numeric',
  text: 'text',
  'character varying': 'text',
  date: 'date',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamp',
  boolean: 'boolean',
};

function toCell(v: unknown, type: string): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const iso = v.toISOString();
    return type === 'date' ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (typeof v === 'bigint') return Number(v);
  if (type === 'numeric' || type === 'bigint') return Number(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return v as Cell;
}

async function materialise(raw: Dataset, design: Design): Promise<{ ok: true; tables: TableDef[] } | { ok: false; error: string }> {
  const db = await PGlite.create();
  try {
    await db.exec(datasetToSql(raw, 'raw'));
    await db.exec('DROP SCHEMA IF EXISTS stage CASCADE; CREATE SCHEMA stage; SET search_path TO raw, stage');
    const tables: TableDef[] = [];
    for (const t of design.tables) {
      try {
        await db.exec(`CREATE TABLE stage.${quoteIdent(t.name)} AS ${t.sql.replace(/;\s*$/, '')}`);
      } catch (e) {
        return { ok: false, error: `Table ${t.name}: ${(e as Error).message}` };
      }
      const count = (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stage.${quoteIdent(t.name)}`)).rows[0].n;
      if (count === 0) return { ok: false, error: `Table ${t.name} is empty.` };
      if (count > 6000) return { ok: false, error: `Table ${t.name} has ${count} rows; keep each table ≤ 6000 (sample or aggregate).` };
      if (t.primary_key.length) {
        const pk = t.primary_key.map(quoteIdent).join(', ');
        const dup = (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM (SELECT ${pk} FROM stage.${quoteIdent(t.name)} GROUP BY ${pk} HAVING COUNT(*) > 1) d`)).rows[0].n;
        if (dup) return { ok: false, error: `Primary key (${t.primary_key.join(', ')}) of ${t.name} is not unique (${dup} duplicates). Use DISTINCT/ROW_NUMBER to build unique ids.` };
      }
      const cols = await db.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'stage' AND table_name = $1 ORDER BY ordinal_position`,
        [t.name]
      );
      const columns: ColumnDef[] = cols.rows.map((c) => ({
        name: c.column_name,
        type: TYPE_MAP[c.data_type] ?? 'text',
        pk: t.primary_key.includes(c.column_name) || undefined,
        note: t.notes[c.column_name],
      }));
      const rows = await db.query<unknown[]>(`SELECT * FROM stage.${quoteIdent(t.name)}`, [], { rowMode: 'array' });
      tables.push({
        name: t.name,
        description: t.description,
        columns,
        rows: rows.rows.map((r) => r.map((v, i) => toCell(v, columns[i].type))),
      });
    }
    // foreign keys: keep only those that fully resolve
    for (const t of design.tables) {
      for (const ref of t.references) {
        const orphans = await db
          .query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM stage.${quoteIdent(t.name)} a
             WHERE a.${quoteIdent(ref.column)} IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM stage.${quoteIdent(ref.table)} b WHERE b.${quoteIdent(ref.target_column)} = a.${quoteIdent(ref.column)})`
          )
          .then((r) => r.rows[0].n)
          .catch(() => -1);
        const col = tables.find((x) => x.name === t.name)?.columns.find((c) => c.name === ref.column);
        if (col && orphans === 0) col.ref = `${ref.table}.${ref.target_column}`;
      }
    }
    if (!tables.some((t) => t.columns.some((c) => c.ref))) {
      return { ok: false, error: 'No foreign key resolved — the schema must have at least one valid relationship between tables.' };
    }
    return { ok: true, tables };
  } finally {
    await db.close();
  }
}

/** Runs one scouting mission. Returns the stored dataset (or null) and a step log. */
export async function scout({ week, domain }: { week: string; domain?: Exclude<DomainKey, 'general'> }): Promise<{ dataset: Dataset | null; log: ScoutLog[] }> {
  const log: ScoutLog[] = [];
  const note = (step: string, ok: boolean, detail?: string) => log.push({ step, ok, detail: detail?.slice(0, 500) });
  auth();
  const dom = domain ?? pickDomain(week);
  const known = new Set([...datasets().values()].map((d) => d.source.slug).filter(Boolean) as string[]);

  // 1. search
  const queries = DOMAIN_QUERIES[dom];
  const q1 = queries[hashString(week + 'a') % queries.length];
  const q2 = queries[hashString(week + 'b') % queries.length];
  const found = new Map<string, Candidate>();
  for (const q of [...new Set([q1, q2])]) {
    try {
      for (const c of await search(q)) found.set(c.ref, c);
      note('search', true, `"${q}"`);
    } catch (e) {
      note('search', false, (e as Error).message);
    }
  }
  const candidates = [...found.values()]
    .filter((c) => c.ref && !known.has(c.ref) && OPEN.test(c.licenseName ?? '') && (c.totalBytes ?? 0) > 20_000 && (c.totalBytes ?? 0) < 30_000_000 && (c.usabilityRating ?? 1) >= 0.7)
    .sort((a, b) => (b.usabilityRating ?? 0) - (a.usabilityRating ?? 0) || (b.voteCount ?? 0) - (a.voteCount ?? 0))
    .slice(0, 6);
  note('filter', candidates.length > 0, `${found.size} found → ${candidates.length} eligible (${dom})`);
  if (!candidates.length) return { dataset: null, log };

  // 2. rank by teachability (one LLM call for all candidates)
  let order = candidates.map((c) => c.ref);
  if (aiAvailable()) {
    try {
      const { data } = await chatJson(
        [
          { role: 'system', content: 'You curate datasets for a SQL learning platform. Prefer data with several entities that can be normalised into 2–5 related tables (ids, categories, dates, numeric measures), realistic business questions, and little free text. Reply JSON only.' },
          { role: 'user', content: `Rank these Kaggle datasets by SQL-teachability (0–10):\n${candidates.map((c) => `- ${c.ref}: ${c.title}${c.subtitle ? ' — ' + c.subtitle : ''}`).join('\n')}\nReturn {"ranking":[{"ref","score","why"}]} best first.` },
        ],
        Ranking,
        { temperature: 0.2, maxTokens: 800 }
      );
      const ranked = data.ranking.filter((r) => candidates.some((c) => c.ref === r.ref)).map((r) => r.ref);
      order = [...ranked, ...order.filter((r) => !ranked.includes(r))];
      note('rank', true, data.ranking.slice(0, 3).map((r) => `${r.ref} (${r.score})`).join(', '));
    } catch (e) {
      note('rank', false, (e as Error).message);
    }
  }

  // 3. download + design + verify (first candidate that survives)
  const { download } = await import('./kaggleSync');
  for (const ref of order.slice(0, 2)) {
    const cand = candidates.find((c) => c.ref === ref)!;
    const key = keyFor(ref);
    let files: string[];
    try {
      files = await download(ref, path.join('scout', key));
      if (!files.length) throw new Error('no CSV files');
      note('download', true, `${ref}: ${files.map((f) => path.basename(f)).join(', ')}`);
    } catch (e) {
      note('download', false, `${ref}: ${(e as Error).message}`);
      continue;
    }
    const raw = ingestCsvFiles({ slug: ref, key, name: cand.title, domain: dom, maxRows: 2500 }, files);
    raw.tables = raw.tables.map((t) => ({ ...t, name: `raw_${t.name}`.slice(0, 40) }));
    const base: Omit<Dataset, 'tables' | 'name' | 'tagline' | 'description'> = {
      key,
      domain: dom,
      source: { kind: 'kaggle', slug: ref, url: `https://www.kaggle.com/datasets/${ref}`, license: cand.licenseName },
      version: week,
    };

    if (!aiAvailable()) {
      const flat = ingestCsvFiles({ slug: ref, key, name: cand.title, domain: dom }, files);
      await storeDataset(flat);
      note('store', true, `${key} (flat ingest, AI unavailable)`);
      return { dataset: flat, log };
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a senior data modeler. Turn raw CSV tables into a small, clean, NORMALISED relational schema (2–5 tables) for SQL practice, written as PostgreSQL 17 SELECT statements over the raw tables.
Rules:
- Each table: {"name": snake_case, "description", "sql": a SELECT over raw_* tables (use DISTINCT / GROUP BY / ROW_NUMBER() to derive dimension tables with surrogate integer ids), "primary_key": [cols], "references": [{"column","table","target_column"}], "notes": {col: short meaning}}.
- Clean types with casts (::int, ::numeric(12,2), ::date, NULLIF(trim(x),'')). Snake_case column names. Drop long free-text columns.
- At least one fact table referencing at least one dimension table. Max 6000 rows per table.
- Fact tables must join to dimensions by the derived ids (join raw rows to the dimension on the natural key inside the SELECT; you may reference previously defined tables by name).
"name" must be a human-readable title in Title Case (e.g. "NYC Yellow Taxi Trips 2017"), never snake_case.
Reply JSON only: {"name","tagline","description","tables":[...]}`,
      },
      { role: 'user', content: `Kaggle dataset: ${ref} — ${cand.title}\nDomain: ${dom}\n\nRAW TABLES:\n${describeSchema(raw, 4)}` },
    ];
    let aiDown = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let design: Design;
      try {
        design = (await chatJson(messages, Design, { temperature: 0.3, maxTokens: 3000, reasoning: 'low' })).data;
        messages.push({ role: 'assistant', content: JSON.stringify(design) });
      } catch (e) {
        note(`design#${attempt}`, false, (e as Error).message);
        aiDown = e instanceof AiUnavailableError;
        break;
      }
      const built = await materialise(raw, design);
      if (!built.ok) {
        note(`materialise#${attempt}`, false, built.error);
        messages.push({ role: 'user', content: `Executing your schema on PostgreSQL failed: ${built.error}\nReturn the full corrected JSON.` });
        continue;
      }
      const ds: Dataset = { ...base, name: design.name, tagline: design.tagline, description: `${design.description}\n\nSource: Kaggle "${ref}" (${cand.licenseName ?? 'open license'}), deterministic sample.`, tables: built.tables };
      await storeDataset(ds);
      note('store', true, `${key}: ${ds.tables.map((t) => `${t.name}(${t.rows.length})`).join(', ')}`);
      return { dataset: ds, log };
    }
    // AI ran out mid-way (quota): still deliver fresh data as typed tables rather than nothing.
    if (aiDown) {
      const flat = ingestCsvFiles({ slug: ref, key, name: cand.title, domain: dom }, files);
      await storeDataset(flat);
      note('store', true, `${key} (flat ingest — AI quota exhausted, schema design skipped)`);
      return { dataset: flat, log };
    }
  }
  return { dataset: null, log };
}

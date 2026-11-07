import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { Cell, Dataset, DomainKey, TableDef } from '@querion/engine';
import { env } from '../env';
import { DATA_DIR, DATASETS_DIR, RAW_DIR } from '../paths';
import { coerce, inferColumns, parseCsv } from './datasets/csv';
import { netflixFromKaggle, olympicsFromKaggle } from './datasets/kaggle';
import { datasets, reloadDatasets, storeDataset } from './registry';

interface CatalogEntry {
  slug: string;
  folder?: string;
  builtin?: 'streamflix' | 'olympics';
  key?: string;
  name?: string;
  domain?: DomainKey;
  maxRows?: number;
}

const API = 'https://www.kaggle.com/api/v1';
const OPEN_LICENSES = /cc0|public domain|cc-by|odbl|attribution|mit|apache|database contents/i;

function auth() {
  if (!env.KAGGLE_USERNAME || !env.KAGGLE_KEY) throw new Error('KAGGLE_USERNAME / KAGGLE_KEY not set');
  return 'Basic ' + Buffer.from(`${env.KAGGLE_USERNAME}:${env.KAGGLE_KEY}`).toString('base64');
}

function catalog(): CatalogEntry[] {
  const file = path.join(DATA_DIR, 'kaggle-catalog.json');
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { datasets: CatalogEntry[] }).datasets;
}

/** Downloads a Kaggle dataset archive and extracts CSV files into data/raw/<folder>. */
export async function download(slug: string, folder: string): Promise<string[]> {
  const res = await fetch(`${API}/datasets/download/${slug}`, { headers: { Authorization: auth() }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Kaggle download ${slug} failed: ${res.status}`);
  const LIMIT = 150_000_000;
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > LIMIT) throw new Error(`archive too large (${(declared / 1e6).toFixed(0)} MB)`);
  // stream with a hard cap — some archives don't declare their size
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > LIMIT) {
      await reader.cancel();
      throw new Error(`archive too large (> ${LIMIT / 1e6} MB)`);
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  // Kaggle archives are ZIP64: the central directory reports sizes as 0xFFFFFFFF,
  // so the size limit is applied to the extracted bytes instead.
  const ZIP64 = 0xffffffff;
  const MAX = 80_000_000;
  const files = unzipSync(buf, {
    filter: (f) => /\.csv$/i.test(f.name) && !f.name.startsWith('__MACOSX') && (f.originalSize === ZIP64 || f.originalSize < MAX),
  });
  const dir = path.join(RAW_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, data] of Object.entries(files).sort((a, b) => b[1].length - a[1].length)) {
    if (data.length > MAX || data.length === 0) continue;
    const out = path.join(dir, path.basename(name));
    fs.writeFileSync(out, data);
    written.push(out);
  }
  return written;
}

const tableName = (file: string) =>
  path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/^(\d)/, 't_$1').slice(0, 40) || 'data';

/** Generic CSV → Dataset ingest with type inference and a deterministic evenly-spaced sample. */
export function ingestCsvFiles(entry: Required<Pick<CatalogEntry, 'slug' | 'key' | 'name' | 'domain'>> & { maxRows?: number }, files: string[]): Dataset {
  const tables: TableDef[] = [];
  for (const file of files.slice(0, 4)) {
    const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
    if (!header || rows.length === 0) continue;
    const step = Math.max(1, Math.ceil(rows.length / (entry.maxRows ?? 1500)));
    const sample = rows.filter((r, i) => i % step === 0 && r.length === header.length);
    const columns = inferColumns(header, sample);
    // de-duplicate column names
    const seen = new Map<string, number>();
    for (const c of columns) {
      const n = seen.get(c.name) ?? 0;
      seen.set(c.name, n + 1);
      if (n) c.name = `${c.name}_${n + 1}`;
    }
    const data: Cell[][] = sample.map((r) => columns.map((c, i) => coerce(r[i], c.type)));
    tables.push({ name: tableName(file), description: `From ${path.basename(file)} (${rows.length.toLocaleString()} rows; deterministic sample of ${data.length})`, columns, rows: data });
  }
  if (!tables.length) throw new Error(`No usable CSV tables in ${entry.slug}`);
  return {
    key: entry.key,
    name: entry.name,
    domain: entry.domain,
    tagline: `Real-world data from Kaggle: ${entry.name}.`,
    description: `Ingested automatically from the Kaggle dataset "${entry.slug}". Column types were inferred; values reflect the source data (including its quirks and NULLs).`,
    source: { kind: 'kaggle', slug: entry.slug, url: `https://www.kaggle.com/datasets/${entry.slug}` },
    version: new Date().toISOString().slice(0, 10),
    tables,
  };
}

/** Looks for a trending, openly-licensed, small CSV dataset not yet in the catalog. */
async function discover(existing: Set<string>): Promise<CatalogEntry | null> {
  const res = await fetch(`${API}/datasets/list?sortBy=hottest&filetype=csv&maxSize=25000000&page=1`, { headers: { Authorization: auth() } });
  if (!res.ok) return null;
  const list = (await res.json()) as { ref?: string; title?: string; licenseName?: string; totalBytes?: number }[];
  const pick = list.find((d) => d.ref && !existing.has(d.ref) && OPEN_LICENSES.test(d.licenseName ?? '') && (d.totalBytes ?? 0) < 25_000_000);
  if (!pick?.ref) return null;
  const key = 'k_' + pick.ref.split('/')[1].replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 24);
  return { slug: pick.ref, key, name: (pick.title ?? key).slice(0, 48), domain: 'general', maxRows: 1500 };
}

/** Syncs the next not-yet-ingested catalog entry (and optionally one discovered dataset). */
export async function kaggleSync({ all = false }: { all?: boolean } = {}): Promise<{ added: string[]; errors: string[] }> {
  auth();
  const added: string[] = [];
  const errors: string[] = [];
  const have = new Set(datasets().keys());
  const entries = catalog();
  const todo = entries.filter((e) => all || !have.has(e.builtin ?? e.key ?? ''));
  if (env.KAGGLE_DISCOVER) {
    const found = await discover(new Set(entries.map((e) => e.slug))).catch(() => null);
    if (found) todo.push(found);
  }
  for (const entry of all ? todo : todo.slice(0, 2)) {
    try {
      const folder = entry.folder ?? entry.key ?? tableName(entry.slug);
      const files = await download(entry.slug, folder);
      let ds: Dataset | null;
      if (entry.builtin === 'streamflix') ds = netflixFromKaggle();
      else if (entry.builtin === 'olympics') ds = olympicsFromKaggle();
      else ds = ingestCsvFiles({ slug: entry.slug, key: entry.key!, name: entry.name ?? entry.key!, domain: entry.domain ?? 'general', maxRows: entry.maxRows }, files);
      if (!ds) throw new Error('normaliser returned nothing');
      // builtin normalisers ship with the repo as JSON; auto-ingested ones live in the DB (survives redeploys)
      if (entry.builtin) fs.writeFileSync(path.join(DATASETS_DIR, `${ds.key}.json`), JSON.stringify(ds));
      else await storeDataset(ds);
      added.push(ds.key);
      console.log(`📦 Kaggle: ingested ${entry.slug} → ${ds.key} (${ds.tables.length} tables)`);
    } catch (e) {
      errors.push(`${entry.slug}: ${(e as Error).message}`);
    }
  }
  if (added.length) await reloadDatasets();
  return { added, errors };
}

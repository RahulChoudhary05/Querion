import fs from 'node:fs';
import path from 'node:path';
import type { Dataset } from '@querion/engine';
import { DATASETS_DIR } from '../paths';

/**
 * Dataset catalog = curated JSON files shipped with the repo (data/datasets)
 * + datasets the Kaggle Scout ingested at runtime (stored in the `datasets`
 * table so they survive redeploys on ephemeral free-tier hosts).
 */
let cache: Map<string, Dataset> | null = null;

function loadFiles(): Map<string, Dataset> {
  const map = new Map<string, Dataset>();
  if (!fs.existsSync(DATASETS_DIR)) return map;
  for (const f of fs.readdirSync(DATASETS_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const ds = JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, f), 'utf8')) as Dataset;
    map.set(ds.key, ds);
  }
  return map;
}

export function datasets(): Map<string, Dataset> {
  if (!cache) cache = loadFiles();
  return cache;
}

export function getDataset(key: string): Dataset | undefined {
  return datasets().get(key);
}

const ACRONYMS = new Set(['nyc', 'usa', 'us', 'uk', 'ev', 'api', 'sql', 'ipl', 'nba', 'nfl', 'f1', 'uber', 'cmrl', 'gdp', 'it', 'ai', 'id']);

/** "nyc_yellow_taxi_2017" → "NYC Yellow Taxi 2017" — machine names never reach the UI. */
export function prettyName(name: string): string {
  if (!/^[a-z0-9_\-\s]+$/.test(name)) return name;
  return name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? (w === 'uber' ? 'Uber' : w.toUpperCase()) : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Merges DB-stored (scouted) datasets into the catalog. Call at boot and after ingest. */
export async function reloadDatasets(): Promise<Map<string, Dataset>> {
  const map = loadFiles();
  try {
    const { getDb } = await import('../db');
    const db = await getDb();
    const res = await db.query<{ body: Dataset | string }>('SELECT body FROM datasets WHERE active ORDER BY created_at');
    for (const r of res.rows) {
      const ds = (typeof r.body === 'string' ? JSON.parse(r.body) : r.body) as Dataset;
      map.set(ds.key, { ...ds, name: prettyName(ds.name) });
    }
  } catch (e) {
    console.warn('Could not load stored datasets:', (e as Error).message);
  }
  cache = map;
  return map;
}

export async function storeDataset(ds: Dataset) {
  const { getDb } = await import('../db');
  const db = await getDb();
  await db.query(
    `INSERT INTO datasets (key, version, domain, source, body) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     ON CONFLICT (key) DO UPDATE SET version = EXCLUDED.version, domain = EXCLUDED.domain, source = EXCLUDED.source, body = EXCLUDED.body, active = true`,
    [ds.key, ds.version, ds.domain, JSON.stringify(ds.source), JSON.stringify(ds)]
  );
  await reloadDatasets();
}

export async function storedDatasetMeta() {
  const { getDb } = await import('../db');
  const db = await getDb();
  const res = await db.query<{ key: string; created_at: string }>('SELECT key, created_at FROM datasets WHERE active ORDER BY created_at DESC');
  return res.rows;
}

export function datasetSummary(ds: Dataset) {
  return {
    key: ds.key,
    name: ds.name,
    domain: ds.domain,
    tagline: ds.tagline,
    description: ds.description,
    source: ds.source,
    version: ds.version,
    tables: ds.tables.map((t) => ({ name: t.name, description: t.description, rowCount: t.rows.length, columns: t.columns })),
  };
}

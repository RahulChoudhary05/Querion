import { quoteIdent, quoteLiteral } from './sql';
import type { Cell, Dataset, TableDef, VariantKind } from './types';

/** Builds the SQL that materialises a dataset inside `schema`. */
export function datasetToSql(dataset: Pick<Dataset, 'tables'>, schema: string): string {
  const s = quoteIdent(schema);
  const parts: string[] = [`DROP SCHEMA IF EXISTS ${s} CASCADE;`, `CREATE SCHEMA ${s};`];
  for (const t of dataset.tables) {
    const pk = t.columns.filter((c) => c.pk).map((c) => quoteIdent(c.name));
    const cols = t.columns.map((c) => `${quoteIdent(c.name)} ${c.type}`);
    if (pk.length) cols.push(`PRIMARY KEY (${pk.join(', ')})`);
    parts.push(`CREATE TABLE ${s}.${quoteIdent(t.name)} (${cols.join(', ')});`);
    const colList = t.columns.map((c) => quoteIdent(c.name)).join(', ');
    for (let i = 0; i < t.rows.length; i += 400) {
      const chunk = t.rows.slice(i, i + 400);
      const values = chunk.map((r) => `(${r.map(quoteLiteral).join(', ')})`).join(',\n');
      parts.push(`INSERT INTO ${s}.${quoteIdent(t.name)} (${colList}) VALUES\n${values};`);
    }
  }
  return parts.join('\n');
}

/** Deterministic PRNG (mulberry32) so variants are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tables nobody references — typically fact/event tables. Safe to thin out without breaking joins. */
function leafTables(tables: TableDef[]): Set<string> {
  const referenced = new Set<string>();
  for (const t of tables) for (const c of t.columns) if (c.ref) referenced.add(c.ref.split('.')[0]);
  return new Set(tables.filter((t) => !referenced.has(t.name)).map((t) => t.name));
}

const isNumericType = (type: string) => /^(int|integer|bigint|smallint|numeric|decimal|real|double|float)/i.test(type);

/**
 * Hidden test cases are *data* variants: the learner's query must be correct on
 * data it has never seen, exactly like hidden test cases in DSA judges.
 *  - reversed: physical row order flipped — catches answers that rely on insertion order
 *  - subset:   ~35% of fact rows removed — catches hard-coded values / magic numbers
 *  - ties:     duplicated measure values — catches missing tie-breakers & DISTINCT bugs
 */
export function makeVariant(dataset: Pick<Dataset, 'key' | 'tables'>, kind: VariantKind): Pick<Dataset, 'tables'> {
  if (kind === 'sample') return { tables: dataset.tables };
  const rand = rng(hashString(`${dataset.key}:${kind}`));
  const leaves = leafTables(dataset.tables);
  const tables = dataset.tables.map((t): TableDef => {
    let rows: Cell[][] = t.rows.map((r) => [...r]);
    if (kind === 'reversed') rows.reverse();
    if (kind === 'subset' && leaves.has(t.name) && rows.length > 6) {
      rows = rows.filter(() => rand() > 0.35);
      rows.reverse();
    }
    if (kind === 'ties' && leaves.has(t.name)) {
      const targets = t.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => !c.pk && !c.ref && isNumericType(c.type));
      for (let r = 1; r < rows.length; r++) {
        if (rand() < 0.22) for (const { i } of targets) rows[r][i] = rows[r - 1][i];
      }
    }
    return { ...t, rows };
  });
  return { tables };
}

export const VARIANTS: { kind: VariantKind; label: string; hidden: boolean }[] = [
  { kind: 'sample', label: 'Sample data', hidden: false },
  { kind: 'reversed', label: 'Shuffled storage order', hidden: true },
  { kind: 'subset', label: 'Sparse data', hidden: true },
  { kind: 'ties', label: 'Ties & duplicates', hidden: true },
];

export function schemaName(datasetKey: string, kind: VariantKind, mirror = false): string {
  return `${datasetKey.replace(/[^a-z0-9_]/gi, '_')}__${kind}${mirror ? '__m' : ''}`.toLowerCase();
}

/** Compact schema description for prompts and the UI. */
export function describeSchema(dataset: Pick<Dataset, 'tables'>, sampleRows = 3): string {
  return dataset.tables
    .map((t) => {
      const cols = t.columns
        .map((c) => `  ${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.ref ? ` -> ${c.ref}` : ''}${c.note ? `  -- ${c.note}` : ''}`)
        .join('\n');
      const sample = t.rows
        .slice(0, sampleRows)
        .map((r) => '  (' + r.map((v) => (v === null ? 'NULL' : JSON.stringify(v))).join(', ') + ')')
        .join('\n');
      return `TABLE ${t.name} (${t.rows.length} rows) — ${t.description}\n${cols}\n sample rows:\n${sample}`;
    })
    .join('\n\n');
}

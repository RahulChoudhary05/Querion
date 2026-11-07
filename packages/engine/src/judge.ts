import type { ResultDiff, ResultSet } from './types';

// Postgres numeric type OIDs: int2, int4, int8, float4, float8, numeric, oid
const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]);
const DATE_OID = 1082;

/** Normalises one cell so semantically equal answers compare equal (e.g. 12 vs 12.00 vs 12.0000001). */
export function normalizeCell(v: unknown, typeId: number): string {
  if (v === null || v === undefined) return '∅';
  if (NUMERIC_OIDS.has(typeId) || typeof v === 'number' || typeof v === 'bigint') {
    const num = Number(v);
    if (Number.isFinite(num)) {
      const fixed = num.toFixed(2);
      return fixed === '-0.00' ? '0.00' : fixed;
    }
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return 'Invalid Date';
    const iso = v.toISOString();
    return typeId === DATE_OID || iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
}

export function normalizeRows(rs: ResultSet): string[][] {
  return rs.rows.map((r) => r.map((v, i) => normalizeCell(v, rs.fields[i]?.dataTypeID ?? 25)));
}

const key = (row: string[]) => JSON.stringify(row);

export interface CompareResult {
  equal: boolean;
  message?: string;
  diff?: ResultDiff;
}

/**
 * Compares a learner result to the reference.
 * Column *names* are not graded (aliases are style), but column count and
 * position are. Row order only matters when the reference has a top-level ORDER BY.
 */
export function compareResults(expected: ResultSet, actual: ResultSet, orderMatters: boolean): CompareResult {
  const expectedColumns = expected.fields.map((f) => f.name);
  const actualColumns = actual.fields.map((f) => f.name);
  const exp = normalizeRows(expected);
  const act = normalizeRows(actual);
  const base: ResultDiff = {
    orderMatters,
    expectedColumns,
    actualColumns,
    expectedRowCount: exp.length,
    actualRowCount: act.length,
    missing: [],
    extra: [],
  };

  if (expectedColumns.length !== actualColumns.length) {
    return {
      equal: false,
      message: `Expected ${expectedColumns.length} column(s) [${expectedColumns.join(', ')}] but your query returned ${actualColumns.length} [${actualColumns.join(', ')}].`,
      diff: base,
    };
  }

  // multiset difference
  const counts = new Map<string, number>();
  for (const r of exp) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  const extra: string[][] = [];
  for (const r of act) {
    const k = key(r);
    const c = counts.get(k) ?? 0;
    if (c > 0) counts.set(k, c - 1);
    else extra.push(r);
  }
  const missing: string[][] = [];
  for (const r of exp) {
    const k = key(r);
    const c = counts.get(k) ?? 0;
    if (c > 0) {
      missing.push(r);
      counts.set(k, c - 1);
    }
  }

  if (missing.length || extra.length) {
    let message: string;
    if (act.length !== exp.length) message = `Expected ${exp.length} row(s), got ${act.length}.`;
    else message = `Row count matches (${exp.length}) but ${missing.length} row(s) have different values.`;
    return { equal: false, message, diff: { ...base, missing: missing.slice(0, 8), extra: extra.slice(0, 8) } };
  }

  if (orderMatters) {
    for (let i = 0; i < exp.length; i++) {
      if (key(exp[i]) !== key(act[i])) {
        return {
          equal: false,
          message: `All rows are correct but the order is wrong (first difference at row ${i + 1}). Check your ORDER BY and tie-breakers.`,
          diff: { ...base, orderMismatchAt: i },
        };
      }
    }
  }
  return { equal: true };
}

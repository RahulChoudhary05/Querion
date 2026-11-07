import type { Cell, ColumnDef } from '@querion/engine';

/** RFC 4180 CSV parser (quoted fields, embedded newlines, CRLF/CR/LF line endings). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// identifiers learners would otherwise have to double-quote
const RESERVED = new Set(['order', 'group', 'user', 'select', 'from', 'where', 'table', 'limit', 'offset', 'desc', 'asc', 'end', 'default', 'check', 'column', 'case', 'when', 'to', 'all', 'and', 'or', 'not', 'primary', 'references', 'unique', 'window', 'with']);

const NULLISH =new Set(['', 'NA', 'N/A', 'null', 'NULL', 'nan', 'NaN']);

/** Infers a Postgres type per column from sample values. */
export function inferColumns(header: string[], rows: string[][]): ColumnDef[] {
  return header.map((h, ci) => {
    const vals = rows.map((r) => r[ci]).filter((v) => v !== undefined && !NULLISH.has(v.trim()));
    const all = (re: RegExp) => vals.length > 0 && vals.every((v) => re.test(v.trim()));
    let type = 'text';
    if (all(/^-?\d{1,9}$/)) type = 'integer';
    else if (all(/^-?\d+(\.\d+)?$/)) type = 'numeric';
    else if (all(/^\d{4}-\d{2}-\d{2}$/)) type = 'date';
    else if (all(/^(true|false)$/i)) type = 'boolean';
    let name = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `col_${ci + 1}`;
    if (/^\d/.test(name)) name = `c_${name}`;
    if (RESERVED.has(name)) name = `${name}_`;
    const nullable = vals.length < rows.length;
    return { name, type, nullable };
  });
}

export function coerce(v: string | undefined, type: string): Cell {
  if (v === undefined || NULLISH.has(v.trim())) return null;
  const s = v.trim();
  if (type === 'integer' || type === 'numeric') return Number(s);
  if (type === 'boolean') return /^true$/i.test(s);
  return s;
}

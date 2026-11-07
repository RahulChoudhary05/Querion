import type { SqlError } from './types';

/**
 * A tiny SQL tokenizer that understands comments, quoted identifiers, string
 * literals (incl. E'' escapes) and dollar-quoted strings. It is not a parser —
 * it exists so guards and heuristics never get fooled by keywords inside
 * strings or comments (the main weakness of regex-on-raw-SQL approaches).
 */
export interface Token {
  kind: 'word' | 'string' | 'ident' | 'punct' | 'number' | 'space';
  text: string;
  start: number;
  /** Parenthesis depth at this token. */
  depth: number;
}

export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let depth = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const start = i;
    // line comment
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      out.push({ kind: 'space', text: ' ', start, depth });
      continue;
    }
    // block comment (nested, like Postgres)
    if (ch === '/' && sql[i + 1] === '*') {
      let level = 0;
      while (i < n) {
        if (sql[i] === '/' && sql[i + 1] === '*') { level++; i += 2; continue; }
        if (sql[i] === '*' && sql[i + 1] === '/') { level--; i += 2; if (level === 0) break; continue; }
        i++;
      }
      out.push({ kind: 'space', text: ' ', start, depth });
      continue;
    }
    if (/\s/.test(ch)) {
      while (i < n && /\s/.test(sql[i])) i++;
      out.push({ kind: 'space', text: ' ', start, depth });
      continue;
    }
    // string literal ('' escaping, optional E prefix handled by word path)
    if (ch === "'") {
      i++;
      while (i < n) {
        if (sql[i] === '\\' && /[eE]/.test(sql[start - 1] ?? '')) { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out.push({ kind: 'string', text: sql.slice(start, i), start, depth });
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out.push({ kind: 'ident', text: sql.slice(start, i), start, depth });
      continue;
    }
    // dollar quoting: $tag$ ... $tag$
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        out.push({ kind: 'string', text: sql.slice(start, i), start, depth });
        continue;
      }
    }
    if (/[A-Za-z_]/.test(ch)) {
      while (i < n && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      out.push({ kind: 'word', text: sql.slice(start, i), start, depth });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      while (i < n && /[0-9.eE]/.test(sql[i])) i++;
      out.push({ kind: 'number', text: sql.slice(start, i), start, depth });
      continue;
    }
    if (ch === '(') { out.push({ kind: 'punct', text: ch, start, depth }); depth++; i++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); out.push({ kind: 'punct', text: ch, start, depth }); i++; continue; }
    out.push({ kind: 'punct', text: ch, start, depth });
    i++;
  }
  return out;
}

const words = (tokens: Token[]) => tokens.filter((t) => t.kind === 'word');

/** Removes trailing semicolons/whitespace and returns the statements found. */
export function splitStatements(sql: string): string[] {
  const tokens = tokenize(sql);
  const parts: string[] = [];
  let from = 0;
  for (const t of tokens) {
    if (t.kind === 'punct' && t.text === ';' && t.depth === 0) {
      parts.push(sql.slice(from, t.start));
      from = t.start + 1;
    }
  }
  parts.push(sql.slice(from));
  return parts.filter((p) => tokenize(p).some((t) => t.kind !== 'space'));
}

/** True when the outermost query has an ORDER BY (meaning row order is part of the answer). */
export function hasTopLevelOrderBy(sql: string): boolean {
  const ws = words(tokenize(sql));
  for (let i = 0; i < ws.length - 1; i++) {
    if (ws[i].depth === 0 && ws[i].text.toUpperCase() === 'ORDER' && ws[i + 1].text.toUpperCase() === 'BY') return true;
  }
  return false;
}

// Only words that can never be part of a legitimate read query. Statement-level
// words (SET, BEGIN, ...) are already impossible because we accept one SELECT.
const FORBIDDEN_WORDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE',
  'COPY', 'VACUUM', 'REINDEX', 'LISTEN', 'NOTIFY', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'DEALLOCATE',
]);

const FORBIDDEN_FUNCTIONS = /^(pg_sleep\w*|set_config|pg_read_\w+|pg_ls_\w+|lo_\w+|dblink\w*|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_advisory\w*|query_to_xml\w*|current_setting)$/i;

export interface GuardResult {
  ok: boolean;
  sql: string;
  error?: SqlError;
}

/**
 * Validates a learner query before it reaches Postgres. Execution additionally
 * happens inside a READ ONLY transaction on a throwaway in-memory PGlite
 * instance, so this guard is about clear feedback, not the last line of defence.
 */
export function guardQuery(raw: string): GuardResult {
  const fail = (message: string, hint?: string): GuardResult => ({
    ok: false,
    sql: raw,
    error: { message, hint, phase: 'guard' },
  });
  if (!raw || !raw.trim()) return fail('Write a query first — the editor is empty.');
  if (raw.length > 20_000) return fail('Query is too long (20k character limit).');

  const statements = splitStatements(raw);
  if (statements.length === 0) return fail('Only comments found — write a SELECT statement.');
  if (statements.length > 1) {
    return fail(
      `Found ${statements.length} statements. Submit exactly one query.`,
      'Remove extra statements or semicolons between queries.'
    );
  }
  const sql = statements[0].trim();
  const tokens = tokenize(sql);
  const ws = words(tokens);
  const first = ws[0]?.text.toUpperCase();
  if (!first || !['SELECT', 'WITH', 'VALUES', 'TABLE'].includes(first)) {
    return fail(
      `Queries must start with SELECT or WITH (found "${ws[0]?.text ?? sql.slice(0, 12)}").`,
      'This studio is read-only: you analyse data, you do not modify it.'
    );
  }
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i].text.toUpperCase();
    if (FORBIDDEN_WORDS.has(w)) {
      return fail(`"${ws[i].text}" is not allowed here — only read-only SELECT queries can run.`);
    }
    if (FORBIDDEN_FUNCTIONS.test(ws[i].text)) {
      return fail(`Function "${ws[i].text}" is disabled in the sandbox.`);
    }
    if (w === 'INTO') return fail('SELECT ... INTO is not allowed (it creates a table).');
  }
  return { ok: true, sql };
}

/** Lowercases unquoted identifiers & keywords and collapses whitespace — used to compare SQL texts. */
export function fingerprint(sql: string): string {
  return tokenize(sql)
    .filter((t) => t.kind !== 'space')
    .map((t) => (t.kind === 'word' ? t.text.toLowerCase() : t.text))
    .join(' ');
}

export function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export function quoteLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

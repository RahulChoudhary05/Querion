import type { Dataset, SqlError } from './types';

export interface ErrorInsight {
  title: string;
  explanation: string;
  suggestions: string[];
  /** 1-based line/column of the error in the user's SQL, if Postgres reported a position. */
  line?: number;
  column?: number;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function closest(word: string, candidates: string[], max = 3): string[] {
  const w = word.toLowerCase();
  return candidates
    .map((c) => ({ c, d: levenshtein(w, c.toLowerCase()) - (c.toLowerCase().includes(w) || w.includes(c.toLowerCase()) ? 2 : 0) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(w.length / 2)))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.c);
}

function locate(sql: string, position?: number) {
  if (!position) return {};
  const before = sql.slice(0, position - 1);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Turns raw Postgres errors into learner-friendly guidance — instantly and
 * offline. The AI tutor builds on top of this, but nothing here needs a key.
 */
export function explainError(error: SqlError, sql: string, dataset?: Pick<Dataset, 'tables'>): ErrorInsight {
  const pos = locate(sql, error.position);
  const tables = dataset?.tables ?? [];
  const allColumns = [...new Set(tables.flatMap((t) => t.columns.map((c) => c.name)))];
  const tableNames = tables.map((t) => t.name);
  const msg = error.message;

  if (error.phase === 'guard') {
    return { title: 'Query blocked', explanation: msg, suggestions: error.hint ? [error.hint] : [], ...pos };
  }
  if (error.phase === 'timeout') {
    return {
      title: 'Time limit exceeded',
      explanation: 'Your query ran for too long. This usually means an accidental cross join (a JOIN without an ON condition) or a correlated subquery that runs once per row.',
      suggestions: ['Make sure every JOIN has an ON clause.', 'Try aggregating in a CTE first, then joining.'],
      ...pos,
    };
  }

  switch (error.code) {
    case '42703': {
      const m = /column "?([^"\s]+)"? does not exist/i.exec(msg);
      const bad = m?.[1]?.split('.').pop() ?? '';
      const near = bad ? closest(bad, allColumns) : [];
      const owners = near.map((c) => `${c} (in ${tables.filter((t) => t.columns.some((x) => x.name === c)).map((t) => t.name).join(', ')})`);
      return {
        title: `Unknown column "${bad}"`,
        explanation: `Postgres could not find a column named "${bad}" in the tables your query reads from.${/"[A-Z]/.test(sql) ? ' Note: double-quoted identifiers are case-sensitive.' : ''}`,
        suggestions: [
          ...(near.length ? [`Did you mean: ${owners.join(' · ')}?`] : []),
          'Check the alias prefix — `o.total` only works if `o` refers to a table that has `total`.',
          'Column aliases from SELECT cannot be used in WHERE; repeat the expression or use a CTE.',
        ],
        ...pos,
      };
    }
    case '42P01': {
      const m = /relation "([^"]+)" does not exist/i.exec(msg);
      const bad = m?.[1] ?? '';
      const near = closest(bad, tableNames);
      return {
        title: `Unknown table "${bad}"`,
        explanation: `There is no table called "${bad}" in this dataset.`,
        suggestions: [near.length ? `Did you mean ${near.join(' or ')}?` : `Available tables: ${tableNames.join(', ')}.`],
        ...pos,
      };
    }
    case '42803':
      return {
        title: 'Grouping error',
        explanation: 'When you use GROUP BY (or an aggregate like COUNT/SUM), every selected column must either be in the GROUP BY list or wrapped in an aggregate function.',
        suggestions: [
          'Add the column to GROUP BY, or wrap it in MAX()/MIN()/SUM()/COUNT().',
          'Aggregates are not allowed in WHERE — filter groups with HAVING instead.',
        ],
        ...pos,
      };
    case '42702':
      return {
        title: 'Ambiguous column',
        explanation: 'This column name exists in more than one of the joined tables, so Postgres does not know which one you mean.',
        suggestions: ['Prefix it with a table alias, e.g. `c.name` instead of `name`.'],
        ...pos,
      };
    case '42601': {
      const near = /at or near "([^"]*)"/.exec(msg)?.[1];
      return {
        title: 'Syntax error',
        explanation: near ? `Postgres stopped understanding the query at "${near}".` : 'The query is not valid SQL syntax.',
        suggestions: [
          'Look for a missing comma between selected columns, or a trailing comma before FROM.',
          'Clause order is: SELECT → FROM → JOIN → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT.',
          'Strings use single quotes: \'value\'. Double quotes are for identifiers.',
        ],
        ...pos,
      };
    }
    case '42883':
      return {
        title: 'Function or operator does not exist',
        explanation: 'You called a function with argument types it does not accept (for example comparing text to a number, or ROUND(double precision, int)).',
        suggestions: ['Cast explicitly, e.g. `ROUND(AVG(x)::numeric, 2)` or `col::date`.'],
        ...pos,
      };
    case '22012':
      return {
        title: 'Division by zero',
        explanation: 'A denominator evaluated to 0 for at least one row.',
        suggestions: ['Wrap the denominator in NULLIF(denominator, 0).'],
        ...pos,
      };
    case '42804':
    case '22P02':
      return {
        title: 'Type mismatch',
        explanation: msg,
        suggestions: ['Compare like with like: numbers to numbers, dates to dates. Use CAST(... AS type) or ::type.'],
        ...pos,
      };
    case '21000':
      return {
        title: 'Subquery returned more than one row',
        explanation: 'A subquery used as a single value (e.g. `= (SELECT ...)`) produced several rows.',
        suggestions: ['Use IN (...) instead of =, or aggregate inside the subquery.'],
        ...pos,
      };
    case '42P10':
    case '42P20':
      return {
        title: 'Clause usage error',
        explanation: msg,
        suggestions: ['Window functions cannot be used in WHERE — compute them in a CTE/subquery and filter outside.'],
        ...pos,
      };
    default:
      return {
        title: 'Query error',
        explanation: msg,
        suggestions: error.hint ? [error.hint] : ['Run smaller pieces of the query to isolate the failing part.'],
        ...pos,
      };
  }
}

/** A scalar cell value as stored in dataset JSON. */
export type Cell = string | number | boolean | null;

export interface ColumnDef {
  name: string;
  /** Postgres type, e.g. `integer`, `numeric(10,2)`, `text`, `date`, `timestamp`, `boolean`. */
  type: string;
  pk?: boolean;
  /** Foreign key reference in the form `table.column` (metadata only — used for ER diagrams and joins). */
  ref?: string;
  nullable?: boolean;
  note?: string;
}

export interface TableDef {
  name: string;
  description: string;
  columns: ColumnDef[];
  rows: Cell[][];
}

export type DomainKey =
  | 'transport'
  | 'automotive'
  | 'engineering'
  | 'commerce'
  | 'sports'
  | 'media'
  | 'health'
  | 'finance'
  | 'general';

export interface Dataset {
  key: string;
  name: string;
  domain: DomainKey;
  tagline: string;
  description: string;
  source: { kind: 'synthetic' | 'kaggle'; url?: string; license?: string; slug?: string };
  version: string;
  tables: TableDef[];
}

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export type Cadence = 'core' | 'daily' | 'weekly' | 'monthly';

/** A judged test case: a named variant of the dataset plus the expected output of the reference query. */
export interface TestCase {
  id: string;
  label: string;
  hidden: boolean;
  variant: VariantKind;
  expected: ResultSet;
}

export type VariantKind = 'sample' | 'reversed' | 'subset' | 'ties';

export interface ProblemSpec {
  slug: string;
  title: string;
  difficulty: Difficulty;
  datasetKey: string;
  topics: string[];
  /** Markdown statement. */
  statement: string;
  /** Column names the answer must return, in order. */
  outputColumns: string[];
  referenceSql: string;
  /** Progressive hints: nudge → concept → skeleton. */
  hints: [string, string, string];
  /** Short explanation of the optimal approach (revealed after solving). */
  explanation: string;
  cadence: Cadence;
  /** Optional ISO date this problem was forged for. */
  forgedFor?: string | null;
  origin: 'curated' | 'ai';
}

export interface ResultField {
  name: string;
  dataTypeID: number;
}

export interface ResultSet {
  fields: ResultField[];
  rows: unknown[][];
  /** Present when the result was truncated to the row cap. */
  truncated?: boolean;
}

export interface ExecSuccess {
  ok: true;
  result: ResultSet;
  ms: number;
}

export interface ExecFailure {
  ok: false;
  error: SqlError;
  ms: number;
}

export type ExecOutcome = ExecSuccess | ExecFailure;

export interface SqlError {
  message: string;
  code?: string;
  position?: number;
  hint?: string;
  detail?: string;
  /** Where the failure came from: our guard (before Postgres) or Postgres itself. */
  phase: 'guard' | 'postgres' | 'timeout';
}

/** INEFFICIENT = correct on every test, but over the problem's planner-cost budget (Architect tier). */
export type VerdictKind = 'ACCEPTED' | 'WRONG_ANSWER' | 'RUNTIME_ERROR' | 'TIME_LIMIT' | 'REJECTED' | 'INEFFICIENT';

export interface CaseVerdict {
  caseId: string;
  label: string;
  hidden: boolean;
  verdict: VerdictKind;
  ms: number;
  message?: string;
  diff?: ResultDiff;
}

export interface ResultDiff {
  orderMatters: boolean;
  expectedColumns: string[];
  actualColumns: string[];
  expectedRowCount: number;
  actualRowCount: number;
  /** Rows the reference produced that the user's query did not (normalized, max 8). */
  missing: string[][];
  /** Rows the user's query produced that the reference did not (normalized, max 8). */
  extra: string[][];
  /** First index where ordered output diverged (when order matters and multisets match). */
  orderMismatchAt?: number;
}

export interface JudgeReport {
  verdict: VerdictKind;
  passed: number;
  total: number;
  cases: CaseVerdict[];
  ms: number;
  /** Planner cost comparison on the sample dataset (lower is better). */
  efficiency?: { userCost: number; referenceCost: number; ratio: number; budget?: number | null } | null;
}

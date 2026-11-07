import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env';
import { RUNTIME_DIR } from '../paths';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
  driver: 'pglite' | 'postgres';
}

const MIGRATIONS = [
  `ALTER TABLE problems ADD COLUMN IF NOT EXISTS tier INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE problems ADD COLUMN IF NOT EXISTS cost_budget REAL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_in BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding JSONB NOT NULL DEFAULT '{}'`,
  // auth hardening
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ`,
  /* Server-side sessions. Only an HMAC of the token is stored, so a database leak
     cannot be replayed as a login. Sessions are revocable (logout, logout-all, password change). */
  `CREATE TABLE IF NOT EXISTS auth_sessions (
     id           SERIAL PRIMARY KEY,
     token_hash   TEXT UNIQUE NOT NULL,
     user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     expires_at   TIMESTAMPTZ NOT NULL,
     ip           TEXT,
     user_agent   TEXT,
     revoked_at   TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id)`,
  /* single-use, short-lived password reset tokens (hashed) */
  `CREATE TABLE IF NOT EXISTS password_resets (
     id          SERIAL PRIMARY KEY,
     token_hash  TEXT UNIQUE NOT NULL,
     user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at  TIMESTAMPTZ NOT NULL,
     used_at     TIMESTAMPTZ
   )`,
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  handle        TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problems (
  id             SERIAL PRIMARY KEY,
  slug           TEXT UNIQUE NOT NULL,
  title          TEXT NOT NULL,
  difficulty     TEXT NOT NULL,
  dataset_key    TEXT NOT NULL,
  topics         TEXT[] NOT NULL DEFAULT '{}',
  statement      TEXT NOT NULL,
  output_columns TEXT[] NOT NULL DEFAULT '{}',
  reference_sql  TEXT NOT NULL,
  hints          JSONB NOT NULL,
  explanation    TEXT NOT NULL DEFAULT '',
  cadence        TEXT NOT NULL DEFAULT 'core',
  origin         TEXT NOT NULL DEFAULT 'curated',
  forged_for     DATE,
  order_matters  BOOLEAN NOT NULL DEFAULT false,
  test_cases     JSONB NOT NULL,
  quality        JSONB NOT NULL DEFAULT '{}',
  fingerprint    TEXT NOT NULL DEFAULT '',
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS problems_dataset_idx ON problems (dataset_key);

CREATE TABLE IF NOT EXISTS submissions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  client_id   TEXT,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  sql         TEXT NOT NULL,
  verdict     TEXT NOT NULL,
  passed      INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  runtime_ms  REAL NOT NULL DEFAULT 0,
  plan_cost   REAL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_user_idx ON submissions (user_id, problem_id);
CREATE INDEX IF NOT EXISTS submissions_client_idx ON submissions (client_id, problem_id);

CREATE TABLE IF NOT EXISTS schedule (
  day        DATE NOT NULL,
  cadence    TEXT NOT NULL,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  PRIMARY KEY (day, cadence, problem_id)
);

CREATE TABLE IF NOT EXISTS datasets (
  key         TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  domain      TEXT NOT NULL,
  source      JSONB NOT NULL DEFAULT '{}',
  body        JSONB NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insights (
  week        DATE PRIMARY KEY,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forge_runs (
  id          SERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  cadence     TEXT NOT NULL,
  dataset_key TEXT,
  status      TEXT NOT NULL DEFAULT 'running',
  problem_id  INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  log         JSONB NOT NULL DEFAULT '[]'
);
`;

async function createDb(): Promise<Db> {
  if (env.DB_DRIVER === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('DB_DRIVER=postgres requires DATABASE_URL');
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      ssl: /sslmode=require|neon\.tech/.test(env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
      max: 8,
    });
    return {
      driver: 'postgres',
      query: async (sql, params) => pool.query(sql, params as unknown[]) as never,
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(RUNTIME_DIR, 'appdb');
  fs.mkdirSync(dir, { recursive: true });
  let lite: InstanceType<typeof PGlite>;
  try {
    lite = await PGlite.create(dir);
  } catch (e) {
    // A hard-killed dev server can leave the embedded DB unrecoverable. Keep a copy, start fresh
    // (curated problems are re-verified and re-seeded automatically on boot).
    const aside = `${dir}.corrupt-${Date.now()}`;
    console.warn(`⚠️  Local PGlite database could not open (${(e as Error).message}). Moved to ${aside} and starting fresh.`);
    fs.renameSync(dir, aside);
    fs.mkdirSync(dir, { recursive: true });
    lite = await PGlite.create(dir);
  }
  return {
    driver: 'pglite',
    query: (sql, params) => lite.query(sql, params) as never,
    close: () => lite.close(),
  };
}

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await createDb();
      for (const stmt of SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
      for (const m of MIGRATIONS) await db.query(m);
      return db;
    })();
  }
  return dbPromise;
}

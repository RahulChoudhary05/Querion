/**
 * pnpm doctor — checks every external connection with a REAL request and prints a
 * clear table. Secrets are never printed (only "set"/"missing" and the first chars).
 *
 *   Groq (each model) · Gemini (each model) · Kaggle · Database · Resend · JWT/CRON/ADMIN secrets
 */
import { env } from '../env';
import { sandboxSender, sendOne, testEmail } from '../services/mail';

type Status = 'ok' | 'fail' | 'warn' | 'skip';
const rows: { area: string; check: string; status: Status; detail: string }[] = [];
const add = (area: string, check: string, status: Status, detail = '') => rows.push({ area, check, status, detail });
const mask = (v?: string) => (v ? `${v.slice(0, 4)}…(${v.length} chars)` : 'missing');
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const r = await fn();
  return [r, Date.now() - t];
}

async function chatProbe(url: string, key: string, model: string, gemini: boolean) {
  const body: Record<string, unknown> = { model, messages: [{ role: 'user', content: 'Reply with exactly: ok' }], max_tokens: 400 };
  if (gemini) body.reasoning_effort = /gemini-2\./.test(model) ? 'none' : 'low';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  return { status: res.status, text };
}

function explain(status: number, text: string) {
  if (status === 401 || status === 403) return 'key rejected (wrong or revoked key)';
  if (status === 404) return 'model not available for this key';
  if (status === 429) return /per day|daily|quota/i.test(text) ? 'free daily quota used up — resets in ~24h' : 'rate limited — retry in a minute';
  if (status === 400) return `bad request: ${text.slice(0, 120)}`;
  return `HTTP ${status}: ${text.slice(0, 120)}`;
}

async function checkGroq() {
  if (!env.GROQ_API_KEY) return add('AI · Groq (primary)', 'GROQ_API_KEY', 'fail', 'missing — create a free key at https://console.groq.com/keys (starts with gsk_)');
  if (!env.GROQ_API_KEY.startsWith('gsk_')) add('AI · Groq (primary)', 'key format', 'warn', `${mask(env.GROQ_API_KEY)} — Groq keys normally start with gsk_`);
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, signal: AbortSignal.timeout(20_000) }).catch((e) => e as Error);
  if (res instanceof Error || !res.ok) {
    return add('AI · Groq (primary)', 'authentication', 'fail', res instanceof Error ? res.message : explain(res.status, await res.text()));
  }
  const ids = new Set(((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id));
  add('AI · Groq (primary)', 'authentication', 'ok', `${ids.size} models visible`);
  for (const model of list(env.GROQ_MODELS)) {
    if (!ids.has(model)) {
      add('AI · Groq (primary)', model, 'warn', 'not offered to this key — will be skipped automatically');
      continue;
    }
    const [r, ms] = await timed(() => chatProbe('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY!, model, false));
    add('AI · Groq (primary)', model, r.status === 200 ? 'ok' : 'fail', r.status === 200 ? `${ms} ms` : explain(r.status, r.text));
  }
}

async function checkGemini() {
  const area = 'AI · Gemini (backup)';
  if (!list(env.AI_PROVIDERS).includes('gemini')) return add(area, 'AI_PROVIDERS', 'skip', 'disabled (AI_PROVIDERS has no "gemini")');
  if (!env.GEMINI_API_KEY) return add(area, 'GEMINI_API_KEY', 'skip', 'not set (optional)');
  for (const model of list(env.GEMINI_MODELS)) {
    const [r, ms] = await timed(() => chatProbe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env.GEMINI_API_KEY!, model, true));
    add(area, model, r.status === 200 ? 'ok' : r.status === 429 ? 'warn' : 'fail', r.status === 200 ? `${ms} ms` : explain(r.status, r.text));
  }
}

async function checkKaggle() {
  const area = 'Data · Kaggle';
  if (!env.KAGGLE_USERNAME || !env.KAGGLE_KEY) return add(area, 'credentials', 'fail', 'KAGGLE_USERNAME / KAGGLE_KEY missing — weekly fresh datasets disabled');
  const auth = 'Basic ' + Buffer.from(`${env.KAGGLE_USERNAME}:${env.KAGGLE_KEY}`).toString('base64');
  const res = await fetch('https://www.kaggle.com/api/v1/datasets/list?search=bus&filetype=csv&page=1', { headers: { Authorization: auth }, signal: AbortSignal.timeout(20_000) }).catch((e) => e as Error);
  if (res instanceof Error) return add(area, 'search API', 'fail', res.message);
  if (!res.ok) return add(area, 'search API', 'fail', explain(res.status, await res.text()));
  const n = ((await res.json()) as unknown[]).length;
  add(area, 'search API', 'ok', `user ${env.KAGGLE_USERNAME} · ${n} results for "bus"`);
  const dl = await fetch('https://www.kaggle.com/api/v1/datasets/download/shivamb/netflix-shows', { method: 'GET', headers: { Authorization: auth }, redirect: 'follow', signal: AbortSignal.timeout(60_000) }).catch((e) => e as Error);
  if (dl instanceof Error || !dl.ok) return add(area, 'download API', 'fail', dl instanceof Error ? dl.message : `HTTP ${dl.status}`);
  const size = (await dl.arrayBuffer()).byteLength;
  add(area, 'download API', 'ok', `${(size / 1024).toFixed(0)} KB archive downloaded`);
}

async function checkDb() {
  const area = 'Database';
  if (env.DB_DRIVER === 'pglite') {
    add(area, 'driver', 'ok', 'pglite (embedded, local dev) — set DB_DRIVER=postgres to use DATABASE_URL');
  }
  if (!env.DATABASE_URL) return add(area, 'DATABASE_URL', env.DB_DRIVER === 'postgres' ? 'fail' : 'skip', 'not set');
  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
    const [, ms] = await timed(() => client.connect());
    const v = await client.query<{ version: string }>('SELECT version()');
    await client.end();
    add(area, 'DATABASE_URL (Neon/Postgres)', 'ok', `${v.rows[0].version.split(' ').slice(0, 2).join(' ')} · connected in ${ms} ms`);
  } catch (e) {
    add(area, 'DATABASE_URL (Neon/Postgres)', 'fail', (e as Error).message.slice(0, 140));
  }
}

async function checkResend() {
  const area = 'Email · Resend';
  if (!env.RESEND_API_KEY) return add(area, 'RESEND_API_KEY', 'skip', 'not set (optional — no emails sent)');
  // Send to Resend's sandbox inbox: proves the key can send without emailing anyone.
  const r = await sendOne(testEmail('delivered@resend.dev'));
  if (!r.sent) return add(area, 'RESEND_API_KEY', 'fail', r.error ?? 'send failed');
  add(area, 'RESEND_API_KEY', 'ok', 'test send accepted (to delivered@resend.dev)');
  if (sandboxSender())
    add(area, 'MAIL_FROM', 'warn', `${env.MAIL_FROM}: delivers ONLY to your Resend account email. Verify a domain at resend.com/domains and set MAIL_FROM="Querion <no-reply@your-domain>"`);
  else add(area, 'MAIL_FROM', 'ok', env.MAIL_FROM);
  const local = /localhost|127\.0\.0\.1/.test(env.APP_URL);
  add(area, 'APP_URL (links in emails)', local && env.NODE_ENV === 'production' ? 'fail' : local ? 'warn' : 'ok', local ? `${env.APP_URL}: links only work on this machine` : env.APP_URL);
}

function checkSecrets() {
  const area = 'Security';
  const weak = env.JWT_SECRET.startsWith('dev-only') || env.JWT_SECRET.length < 32;
  add(area, 'JWT_SECRET', weak ? (env.NODE_ENV === 'production' ? 'fail' : 'warn') : 'ok', weak ? 'use 32+ random chars in production' : `set (${env.JWT_SECRET.length} chars)`);
  add(area, 'CRON_SECRET', env.CRON_SECRET ? 'ok' : 'warn', env.CRON_SECRET ? 'set — /api/hooks/* enabled' : 'not set — /api/hooks/* disabled (GitHub Actions still works)');
  add(area, 'ADMIN_TOKEN', env.ADMIN_TOKEN ? 'ok' : 'skip', env.ADMIN_TOKEN ? 'set — /api/admin/* enabled' : 'not set — admin API disabled (safe default)');
  add(area, 'CORS_ORIGIN', 'ok', env.CORS_ORIGIN);
}

console.log('\n  ✦ Querion doctor — checking every connection with real requests…\n');
await Promise.all([checkGroq(), checkGemini(), checkKaggle(), checkDb(), checkResend()]);
checkSecrets();

const icon: Record<Status, string> = { ok: '✅', fail: '❌', warn: '⚠️ ', skip: '➖' };
const order = ['AI · Groq (primary)', 'AI · Gemini (backup)', 'Data · Kaggle', 'Database', 'Email · Resend', 'Security'];
for (const area of order) {
  const r = rows.filter((x) => x.area === area);
  if (!r.length) continue;
  console.log(`  ${area}`);
  for (const x of r) console.log(`    ${icon[x.status]} ${x.check.padEnd(30)} ${x.detail}`);
  console.log('');
}
const aiOk = rows.some((r) => r.area.startsWith('AI') && r.status === 'ok' && !/authentication/.test(r.check));
const fails = rows.filter((r) => r.status === 'fail').length;
console.log(`  AI tutor & Nebula forge: ${aiOk ? '✅ at least one model is working' : '❌ NO working AI model — add GROQ_API_KEY'}`);
console.log(`  ${fails ? `${fails} check(s) failed` : 'All required checks passed'}\n`);
process.exit(fails && !aiOk ? 1 : 0);

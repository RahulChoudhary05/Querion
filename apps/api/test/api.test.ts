/**
 * End-to-end API tests: real HTTP requests through the Hono app, real judge
 * workers, real PGlite database in a throwaway directory, cookie sessions.
 * No AI calls (AI disabled → tutor endpoints exercise their offline fallbacks).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'querion-test-'));
Object.assign(process.env, {
  // pin it like everything else: CI runs with NODE_ENV=production, which switches to
  // `__Host-` cookies and strict origins — these tests assert the non-production contract
  NODE_ENV: 'test',
  QUERION_DATA_DIR: dataDir,
  QUERION_NO_LISTEN: '1',
  DB_DRIVER: 'pglite',
  GROQ_API_KEY: '',
  GEMINI_API_KEY: '',
  SCHEDULER_ENABLED: 'false',
  ADMIN_TOKEN: 'test-admin-token-123456',
  CRON_SECRET: 'test-cron-secret-123456',
  PROXY_SECRET: 'test-proxy-secret-123456',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-000000',
  RESEND_API_KEY: '',
});

type App = { request: (path: string, init?: RequestInit) => Promise<Response> | Response };
let app: App;
let closeAll: () => Promise<void>;
let db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

interface CallOpts {
  cookie?: string | null;
  headers?: Record<string, string>;
  csrf?: boolean;
  ip?: string;
}

async function call(method: string, url: string, body?: unknown, o: CallOpts = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': o.ip ?? '203.0.113.7',
    ...(o.csrf === false ? {} : { 'X-Querion-CSRF': '1' }),
    ...(o.cookie ? { Cookie: o.cookie } : {}),
    ...o.headers,
  };
  const res = await app.request(`/api${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie?.match(/qn_session=([^;]*)/)?.[1];
  return { status: res.status, json, headers: res.headers, setCookie, cookie: cookie ? `qn_session=${cookie}` : null };
}

let alice = ''; // session cookie for the main test user

before(async () => {
  const server = await import('../src/server');
  const { getDb } = await import('../src/db');
  const { reloadDatasets } = await import('../src/nebula/registry');
  const { seedIfEmpty } = await import('../src/nebula/seed');
  const { pool } = await import('../src/judge/pool');
  app = server.app as unknown as App;
  db = (await getDb()) as never;
  await reloadDatasets();
  await seedIfEmpty();
  const r = await call('POST', '/auth/register', { handle: 'alice', email: 'Alice@Example.com', password: 'sunny-orbit-42' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  alice = r.cookie!;
  closeAll = async () => {
    await pool.close();
    await (await getDb()).close();
  };
});

after(async () => {
  await closeAll?.();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('sessions & cookies', () => {
  test('session cookie is httpOnly, SameSite=Lax, and the DB never stores the raw token', async () => {
    const r = await call('POST', '/auth/login', { email: 'alice@example.com', password: 'sunny-orbit-42' });
    assert.equal(r.status, 200);
    assert.match(r.setCookie!, /HttpOnly/i);
    assert.match(r.setCookie!, /SameSite=Lax/i);
    assert.match(r.setCookie!, /Path=\//);
    const raw = r.cookie!.split('=')[1];
    const rows = await db.query('SELECT token_hash FROM auth_sessions');
    assert.ok(rows.rows.length >= 2);
    assert.ok(rows.rows.every((x) => x.token_hash !== raw && x.token_hash.length === 64), 'only HMACs stored');
  });

  test('session endpoint reflects the cookie; garbage cookies are ignored', async () => {
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: alice })).json.user.handle, 'alice');
    assert.equal((await call('GET', '/auth/session')).json.user, null);
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: 'qn_session=' + 'x'.repeat(43) })).json.user, null);
  });

  test('CSRF: state-changing requests need the custom header and a same-site origin', async () => {
    const noHeader = await call('POST', '/auth/logout', undefined, { cookie: alice, csrf: false });
    assert.equal(noHeader.status, 403);
    const evil = await call('POST', '/me/sessions/revoke-others', undefined, { cookie: alice, headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: alice })).json.user?.handle, 'alice', 'still signed in');
  });

  test('CSRF: the public site is same-origin when our edge proxy vouches for it', async () => {
    const site = { Origin: 'https://querion.example', 'X-Forwarded-Host': 'querion.example' };
    // empty login → 400 means the CSRF guard let it through; 403 means it was blocked
    const vouched = await call('POST', '/auth/login', {}, { headers: { ...site, 'X-Proxy-Secret': 'test-proxy-secret-123456' } });
    assert.equal(vouched.status, 400, 'proxied same-site request passes the guard');
    const forged = await call('POST', '/auth/login', {}, { headers: { ...site, 'X-Proxy-Secret': 'wrong-secret' } });
    assert.equal(forged.status, 403, 'X-Forwarded-Host without the proxy secret is not trusted');
    const unvouched = await call('POST', '/auth/login', {}, { headers: site });
    assert.equal(unvouched.status, 403);
    const mismatch = await call('POST', '/auth/login', {}, { headers: { Origin: 'https://evil.example', 'X-Forwarded-Host': 'querion.example', 'X-Proxy-Secret': 'test-proxy-secret-123456' } });
    assert.equal(mismatch.status, 403, 'origin must match the host the proxy saw');
  });

  test('protected routes require a session', async () => {
    for (const [m, u] of [['GET', '/me/stats'], ['GET', '/me/sessions'], ['POST', '/problems/electric-fleet-roll-call/submit'], ['POST', '/ai/hint'], ['GET', '/problems/electric-fleet-roll-call/solution']] as const) {
      const r = await call(m, u, m === 'POST' ? { sql: 'select 1', slug: 'x', level: 1 } : undefined);
      assert.equal(r.status, 401, `${m} ${u}`);
    }
    // public catalogue stays public
    assert.equal((await call('GET', '/problems')).status, 200);
    assert.equal((await call('GET', '/today')).status, 200);
  });

  test('logout revokes the session server-side (the old cookie stops working)', async () => {
    const login = await call('POST', '/auth/login', { email: 'alice@example.com', password: 'sunny-orbit-42' });
    const c = login.cookie!;
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: c })).json.user.handle, 'alice');
    const out = await call('POST', '/auth/logout', undefined, { cookie: c });
    assert.match(out.setCookie ?? '', /qn_session=;|Max-Age=0/i);
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: c })).json.user, null, 'replayed cookie rejected');
  });

  test('devices list, revoke one, revoke others', async () => {
    const other = (await call('POST', '/auth/login', { email: 'alice@example.com', password: 'sunny-orbit-42' }, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Safari/604.1' } })).cookie!;
    const list = await call('GET', '/me/sessions', undefined, { cookie: alice });
    assert.ok(list.json.length >= 2);
    assert.equal(list.json.filter((s: any) => s.current).length, 1);
    const target = list.json.find((s: any) => !s.current && /iPhone/.test(s.userAgent));
    assert.equal((await call('DELETE', `/me/sessions/${target.id}`, undefined, { cookie: alice })).status, 200);
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: other })).json.user, null);
    const r = await call('POST', '/me/sessions/revoke-others', undefined, { cookie: alice });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: alice })).json.user.handle, 'alice', 'current session survives');
  });
});

describe('accounts', () => {
  test('registration validation, password policy, duplicates', async () => {
    assert.equal((await call('POST', '/auth/register', { handle: 'x', email: 'bad', password: 'short' })).status, 400);
    const common = await call('POST', '/auth/register', { handle: 'bob_1', email: 'bob@example.com', password: 'password123' });
    assert.equal(common.status, 400);
    assert.match(common.json.error, /common/i);
    const containsHandle = await call('POST', '/auth/register', { handle: 'charlie', email: 'c@example.com', password: 'charlie-2024!' });
    assert.match(containsHandle.json.error, /handle/i);
    assert.equal((await call('POST', '/auth/register', { handle: 'ok_user', email: 'a@b.co', password: 'x1'.repeat(40) })).status, 400, 'over 72 bytes rejected');
    const dupe = await call('POST', '/auth/register', { handle: 'alice2', email: 'ALICE@example.com', password: 'another-pass-7' });
    assert.equal(dupe.status, 409);
  });

  test('wrong password is generic; account locks after repeated failures', async () => {
    await call('POST', '/auth/register', { handle: 'mallory', email: 'mallory@example.com', password: 'correct-horse-9' }, { ip: '198.51.100.20' });
    const unknown = await call('POST', '/auth/login', { email: 'nobody@example.com', password: 'whatever123' }, { ip: '198.51.100.21' });
    const wrong = await call('POST', '/auth/login', { email: 'mallory@example.com', password: 'nope-nope-1' }, { ip: '198.51.100.21' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.json.error, wrong.json.error, 'same message → no account enumeration');
    let locked = false;
    for (let i = 0; i < 9; i++) {
      const r = await call('POST', '/auth/login', { email: 'mallory@example.com', password: `bad-guess-${i}` }, { ip: `198.51.100.${30 + i}` });
      if (r.status === 429 && /Too many failed attempts/.test(r.json.error)) locked = true;
    }
    assert.ok(locked, 'account lockout engaged');
    const good = await call('POST', '/auth/login', { email: 'mallory@example.com', password: 'correct-horse-9' }, { ip: '198.51.100.99' });
    assert.equal(good.status, 429, 'even the right password waits out the lock');
  });

  test('password change signs out other devices and rotates this session', async () => {
    const reg = await call('POST', '/auth/register', { handle: 'dana', email: 'dana@example.com', password: 'first-pass-11' }, { ip: '192.0.2.50' });
    const laptop = reg.cookie!;
    const phone = (await call('POST', '/auth/login', { email: 'dana@example.com', password: 'first-pass-11' }, { ip: '192.0.2.50' })).cookie!;
    const bad = await call('PUT', '/me/password', { current: 'wrong-one-1', next: 'second-pass-22' }, { cookie: laptop, ip: '192.0.2.50' });
    assert.equal(bad.status, 400);
    const ok = await call('PUT', '/me/password', { current: 'first-pass-11', next: 'second-pass-22' }, { cookie: laptop, ip: '192.0.2.50' });
    assert.equal(ok.status, 200);
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: phone })).json.user, null, 'other device signed out');
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: laptop })).json.user, null, 'old cookie on this device rotated');
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: ok.cookie })).json.user.handle, 'dana');
  });

  test('password reset: single-use hashed token, revokes all sessions', async () => {
    const { tokenHash, newToken } = await import('../src/http/auth');
    const reg = await call('POST', '/auth/register', { handle: 'erin', email: 'erin@example.com', password: 'violet-pass-33' }, { ip: '192.0.2.60' });
    const f = await call('POST', '/auth/forgot', { email: 'erin@example.com' }, { ip: '192.0.2.60' });
    assert.equal(f.status, 200);
    const f2 = await call('POST', '/auth/forgot', { email: 'ghost@example.com' }, { ip: '192.0.2.60' });
    assert.deepEqual(f.json, f2.json, 'no enumeration');
    // simulate the emailed link: create a known token for erin
    const token = newToken();
    const u = await db.query("SELECT id FROM users WHERE email = 'erin@example.com'");
    await db.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`, [tokenHash(token), u.rows[0].id]);
    const r = await call('POST', '/auth/reset', { token, password: 'violet-new-pass-44' }, { ip: '192.0.2.60' });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', '/auth/session', undefined, { cookie: reg.cookie })).json.user, null, 'old sessions revoked');
    assert.equal((await call('POST', '/auth/reset', { token, password: 'violet-other-55' }, { ip: '192.0.2.60' })).status, 400, 'single use');
    assert.equal((await call('POST', '/auth/login', { email: 'erin@example.com', password: 'violet-new-pass-44' }, { ip: '192.0.2.61' })).status, 200);
  });
});

describe('catalog', () => {
  test('problem payload never leaks the reference solution or hidden data', async () => {
    const p = await call('GET', '/problems/electric-fleet-roll-call');
    const raw = JSON.stringify(p.json);
    assert.ok(!('reference_sql' in p.json) && !raw.includes('test_cases'));
    assert.equal(p.json.tests.filter((t: any) => t.hidden).length, 3);
    const sm = await call('GET', '/sitemap.xml');
    assert.match(sm.json, /<urlset[\s\S]*\/p\/electric-fleet-roll-call/);
  });
});

describe('judge', () => {
  const slug = 'electric-fleet-roll-call';
  test('accepts a correct alternative query and unlocks the solution', async () => {
    const r = await call('POST', `/problems/${slug}/submit`, { sql: "select registration, model, capacity from buses where fuel_type='electric' order by 3 desc, 1" }, { cookie: alice });
    assert.equal(r.json.report.verdict, 'ACCEPTED');
    assert.equal(r.json.firstSolve, true);
    const sol = await call('GET', `/problems/${slug}/solution`, undefined, { cookie: alice });
    assert.equal(sol.status, 200);
    const stats = await call('GET', '/me/stats', undefined, { cookie: alice });
    assert.equal(stats.json.solved.Easy, 1);
    assert.equal(stats.headers.get('cache-control'), 'private, no-store');
  });

  test('wrong order, runtime error, blocked write, Architect budget', async () => {
    const o = { cookie: alice };
    assert.equal((await call('POST', `/problems/${slug}/submit`, { sql: "select registration, model, capacity from buses where fuel_type='electric' order by 1" }, o)).json.report.verdict, 'WRONG_ANSWER');
    assert.equal((await call('POST', `/problems/${slug}/submit`, { sql: 'select regstration from buses' }, o)).json.report.verdict, 'RUNTIME_ERROR');
    assert.equal((await call('POST', `/problems/${slug}/submit`, { sql: 'delete from buses' }, o)).json.report.verdict, 'REJECTED');
    const naive = `SELECT t.name AS team,
      (SELECT COUNT(*) FROM deployments d JOIN repos r ON r.repo_id=d.repo_id WHERE r.team_id=t.team_id AND d.environment='production') AS prod_deploys,
      ROUND((SELECT COUNT(*) FROM deployments d JOIN repos r ON r.repo_id=d.repo_id WHERE r.team_id=t.team_id AND d.environment='production')/13.0,2) AS deploys_per_week,
      ROUND(100.0*(SELECT COUNT(*) FROM deployments d JOIN repos r ON r.repo_id=d.repo_id WHERE r.team_id=t.team_id AND d.environment='production' AND d.status<>'success')/NULLIF((SELECT COUNT(*) FROM deployments d JOIN repos r ON r.repo_id=d.repo_id WHERE r.team_id=t.team_id AND d.environment='production'),0),1) AS change_failure_pct,
      ROUND((SELECT AVG(EXTRACT(EPOCH FROM i.resolved_at-i.opened_at)/3600) FROM incidents i JOIN repos r ON r.repo_id=i.repo_id WHERE r.team_id=t.team_id AND i.resolved_at IS NOT NULL)::numeric,1) AS mttr_hours
      FROM teams t ORDER BY t.name`;
    const r = await call('POST', '/problems/dora-scorecard-per-team/submit', { sql: naive }, o);
    assert.equal(r.json.report.verdict, 'INEFFICIENT');
  });

  test('runaway query hits the time limit and the judge recovers', async () => {
    const o = { cookie: alice };
    assert.equal((await call('POST', `/problems/${slug}/submit`, { sql: 'select count(*) from trips a, trips b, trips c, trips d' }, o)).json.report.verdict, 'TIME_LIMIT');
    assert.equal((await call('POST', `/problems/${slug}/submit`, { sql: "select registration, model, capacity from buses where fuel_type='electric' order by capacity desc, registration" }, o)).json.report.verdict, 'ACCEPTED');
  });
});

describe('security', () => {
  test('admin and hooks require secrets', async () => {
    assert.equal((await call('GET', '/admin/runs')).status, 403);
    assert.equal((await call('GET', '/admin/runs', undefined, { headers: { 'X-Admin-Token': 'wrong' } })).status, 403);
    assert.equal((await call('GET', '/admin/runs', undefined, { headers: { 'X-Admin-Token': 'test-admin-token-123456' } })).status, 200);
    assert.equal((await call('POST', '/hooks/daily', undefined, { headers: { 'X-Cron-Secret': 'nope' } })).status, 403);
  });

  test('body size limit', async () => {
    const r = await call('POST', '/problems/electric-fleet-roll-call/submit', { sql: 'select 1 -- ' + 'x'.repeat(70_000) }, { cookie: alice });
    assert.equal(r.status, 413);
  });

  test('spoofed X-Forwarded-For cannot dodge IP rate limits', async () => {
    let limited = 0;
    for (let i = 0; i < 45; i++) {
      // the attacker controls the FIRST hop; the last hop is what our load balancer saw
      const r = await call('POST', '/auth/login', { email: `nobody${i}@example.com`, password: 'whatever123' }, { ip: `10.0.0.${i}, 198.51.100.200` });
      if (r.status === 429) limited++;
    }
    assert.ok(limited > 0, 'per-IP bucket kicks in');
  });

  test('AI tutor falls back to curated hints offline; review locked until solved', async () => {
    const o = { cookie: alice, ip: '192.0.2.1' };
    const h = await call('POST', '/ai/hint', { slug: 'electric-fleet-roll-call', level: 1, sql: '' }, o);
    assert.equal(h.json.source, 'curated');
    assert.equal((await call('POST', '/ai/review', { slug: 'week-over-week-ridership', sql: 'select 1', report: {} }, o)).status, 403);
  });
});

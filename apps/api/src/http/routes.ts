import { Hono } from 'hono';
import { z } from 'zod';
import { DOMAINS, TIERS, TOPICS, type ExecOutcome, type JudgeReport } from '@querion/engine';
import { aiEnabled, providers } from '../ai/llm';
import { ask, explainFailure, hint, review } from '../ai/tutor';
import { getDb } from '../db';
import {
  claimGuestProgress,
  getProblemById,
  getProblemBySlug,
  hasSolved,
  listProblems,
  profileStats,
  recordSubmission,
  scheduleFor,
  statusMap,
  submissionsFor,
  type ProblemRow,
} from '../db/repo';
import { env, isProd } from '../env';
import { pool, TimeoutError } from '../judge/pool';
import { forgeProblem } from '../nebula/forge';
import { kaggleSync } from '../nebula/kaggleSync';
import { datasets, datasetSummary, getDataset } from '../nebula/registry';
import { latestInsights } from '../nebula/insights';
import { recommendations } from '../nebula/recommend';
import { catchUp, ensureDaily, mondayOf, monthStart, nextMonday, runWeekly, today } from '../nebula/scheduler';
import { scout } from '../nebula/scout';
import { esc, sendPasswordChanged, sendPasswordReset, sendWelcome, verifyUnsub } from '../services/mail';
import { bodyLimit } from 'hono/body-limit';
import {
  burnPasswordCheck,
  checkPassword,
  clearSessionCookie,
  clientIp,
  endSession,
  hashPassword,
  identify,
  newToken,
  passwordProblem,
  rateLimit,
  requireAuth,
  safeEqual,
  startSession,
  tokenHash,
  type Env,
} from './auth';

export const api = new Hono<Env>();
api.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'Request body too large (64 KB max).' }, 413) }));
api.use('*', identify);
// Everything personal or costly requires a signed-in session.
for (const p of ['/me/*', '/ai/*', '/problems/:slug/submit', '/problems/:slug/run', '/problems/:slug/submissions', '/problems/:slug/solution']) api.use(p, requireAuth);
// personal data must never be cached by browsers, proxies or CDNs
api.use('/me/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'private, no-store');
});

const sqlBody = z.object({ sql: z.string().max(20_000) });
const bad = (msg: string) => ({ error: msg });

/** Public shape of a problem — never includes the reference query or hidden test data. */
function publicProblem(p: ProblemRow, solved: boolean) {
  const sample = p.test_cases.find((t) => !t.hidden);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    datasetKey: p.dataset_key,
    topics: p.topics,
    statement: p.statement,
    outputColumns: p.output_columns,
    orderMatters: p.order_matters,
    tier: p.tier,
    costBudget: p.cost_budget,
    cadence: p.cadence,
    origin: p.origin,
    forgedFor: p.forged_for ? new Date(p.forged_for).toISOString().slice(0, 10) : null,
    quality: { blindSolve: p.quality.blindSolve ?? null, generator: p.quality.generator ?? null, verifiedAt: p.quality.verifiedAt ?? null },
    tests: p.test_cases.map((t) => ({ id: t.id, label: t.label, hidden: t.hidden })),
    sampleExpected: sample ? { fields: sample.expected.fields, rows: sample.expected.rows.slice(0, 50), total: sample.expected.rows.length } : null,
    solved,
    explanation: solved ? p.explanation : null,
  };
}

// ───────── meta & catalog ─────────
api.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

/** Live sitemap of every problem page (problems change weekly, so this can't be static). */
api.get('/sitemap.xml', async (c) => {
  const site = env.APP_URL.replace(/\/$/, '');
  const list = await listProblems();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const urls = list.map((p) => {
    const mod = (p.forged_for ?? String(p.created_at)).slice(0, 10);
    return `  <url><loc>${esc(`${site}/p/${p.slug}`)}</loc><lastmod>${mod}</lastmod><changefreq>monthly</changefreq><priority>${p.origin === 'ai' ? '0.7' : '0.6'}</priority></url>`;
  });
  const tracks = [...datasets().keys()].map((k) => `  <url><loc>${esc(`${site}/tracks/${k}`)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`);
  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...tracks, ...urls].join('\n')}\n</urlset>\n`);
});

api.get('/meta', async (c) => {
  const all = [...datasets().values()];
  const problems = await listProblems();
  return c.json({
    ai: { enabled: aiEnabled(), providers: [...new Map(providers().map((p) => [p.name, { name: p.name, model: p.model }])).values()] },
    domains: Object.entries(DOMAINS).map(([key, d]) => ({
      key,
      ...d,
      datasets: all.filter((x) => x.domain === key).map((x) => x.key),
      problems: problems.filter((p) => getDataset(p.dataset_key)?.domain === key).length,
    })),
    datasets: all.map((d) => ({ key: d.key, name: d.name, domain: d.domain, source: d.source.kind })),
    topics: TOPICS,
    tiers: TIERS,
    counts: {
      problems: problems.length,
      forged: problems.filter((p) => p.origin === 'ai').length,
      datasets: all.length,
      rows: all.reduce((s, d) => s + d.tables.reduce((t, x) => t + x.rows.length, 0), 0),
    },
  });
});

api.get('/datasets', (c) => c.json([...datasets().values()].map(datasetSummary)));

api.get('/datasets/:key', (c) => {
  const ds = getDataset(c.req.param('key'));
  if (!ds) return c.json(bad('Dataset not found'), 404);
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json(ds);
});

/** A dataset's learning ladder: problems grouped by tier, with the caller's progress. */
api.get('/tracks/:key', async (c) => {
  const ds = getDataset(c.req.param('key'));
  if (!ds) return c.json(bad('Track not found'), 404);
  const [list, status] = await Promise.all([listProblems(), statusMap(c.get('identity'))]);
  const mine = list.filter((p) => p.dataset_key === ds.key);
  return c.json({
    dataset: datasetSummary(ds),
    tiers: TIERS.map((t) => ({
      ...t,
      problems: mine.filter((p) => p.tier === t.tier).map((p) => ({ slug: p.slug, title: p.title, difficulty: p.difficulty, topics: p.topics, origin: p.origin, status: status[p.id] ?? null })),
    })),
  });
});

// ───────── problems ─────────
api.get('/problems', async (c) => {
  const [list, status] = await Promise.all([listProblems(), statusMap(c.get('identity'))]);
  return c.json(
    list.map((p) => ({
      ...p,
      domain: getDataset(p.dataset_key)?.domain ?? 'general',
      datasetName: getDataset(p.dataset_key)?.name ?? p.dataset_key,
      status: status[p.id] ?? null,
    }))
  );
});

api.get('/problems/:slug', async (c) => {
  const p = await getProblemBySlug(c.req.param('slug'));
  if (!p) return c.json(bad('Problem not found'), 404);
  return c.json(publicProblem(p, await hasSolved(c.get('identity'), p.id)));
});

api.get('/problems/:slug/submissions', async (c) => {
  const p = await getProblemBySlug(c.req.param('slug'));
  if (!p) return c.json(bad('Problem not found'), 404);
  return c.json(await submissionsFor(c.get('identity'), p.id));
});

api.get('/problems/:slug/solution', async (c) => {
  const p = await getProblemBySlug(c.req.param('slug'));
  if (!p) return c.json(bad('Problem not found'), 404);
  const solved = await hasSolved(c.get('identity'), p.id);
  if (!solved && c.req.query('reveal') !== '1') return c.json(bad('Solve it first — or reveal it explicitly.'), 403);
  return c.json({ sql: p.reference_sql, explanation: p.explanation, revealed: !solved });
});

function timeLimitReport(total: number, ms: number): JudgeReport {
  return {
    verdict: 'TIME_LIMIT',
    passed: 0,
    total,
    ms,
    cases: [{ caseId: 'sample', label: 'Sample data', hidden: false, verdict: 'TIME_LIMIT', ms, message: `Stopped after ${ms} ms. Look for a JOIN without an ON condition.` }],
  };
}

api.post('/problems/:slug/submit', rateLimit('submit', 40, 60_000), async (c) => {
  const body = sqlBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Body must be { sql: string }'), 400);
  const p = await getProblemBySlug(c.req.param('slug'));
  if (!p) return c.json(bad('Problem not found'), 404);
  let report: JudgeReport;
  try {
    report = await pool.run<JudgeReport>({
      type: 'judge',
      dataset: getDataset(p.dataset_key)!,
      testCases: p.test_cases,
      sql: body.data.sql,
      orderMatters: p.order_matters,
      referenceSql: p.reference_sql,
    });
  } catch (e) {
    if (e instanceof TimeoutError) report = timeLimitReport(p.test_cases.length, env.JUDGE_TIMEOUT_MS);
    else throw e;
  }
  // Architect tier: correct is not enough — the plan must fit the cost budget.
  if (report.verdict === 'ACCEPTED' && p.cost_budget && report.efficiency) {
    report.efficiency.budget = p.cost_budget;
    if (report.efficiency.userCost > p.cost_budget) {
      report.verdict = 'INEFFICIENT';
      report.cases.push({
        caseId: 'budget',
        label: 'Performance budget',
        hidden: false,
        verdict: 'INEFFICIENT',
        ms: 0,
        message: `Correct on every dataset, but the planner cost is ${report.efficiency.userCost.toFixed(1)} — the budget is ${p.cost_budget.toFixed(1)}. Remove repeated scans (correlated subqueries, fan-out joins) and try again.`,
      });
    }
  }
  const id = c.get('identity');
  const firstSolve = report.verdict === 'ACCEPTED' && !(await hasSolved(id, p.id));
  if (id.userId || id.clientId) await recordSubmission(id, p.id, body.data.sql, report);
  return c.json({ report, firstSolve, explanation: report.verdict === 'ACCEPTED' ? p.explanation : null });
});

/** Server-side run (fallback when the in-browser engine is unavailable). */
api.post('/problems/:slug/run', rateLimit('run', 60, 60_000), async (c) => {
  const body = sqlBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Body must be { sql: string }'), 400);
  const p = await getProblemBySlug(c.req.param('slug'));
  if (!p) return c.json(bad('Problem not found'), 404);
  try {
    return c.json(await pool.run<ExecOutcome>({ type: 'run', dataset: getDataset(p.dataset_key)!, sql: body.data.sql }));
  } catch (e) {
    if (e instanceof TimeoutError) return c.json({ ok: false, ms: env.JUDGE_TIMEOUT_MS, error: { message: e.message, phase: 'timeout' } });
    throw e;
  }
});

// ───────── calendar ─────────
api.get('/today', async (c) => {
  const day = today();
  const [d, w, m] = await Promise.all([scheduleFor(day), scheduleFor(mondayOf(day)), scheduleFor(monthStart(day))]);
  const status = await statusMap(c.get('identity'));
  const load = async (ids: number[]) =>
    (await Promise.all(ids.map((id) => getProblemById(id))))
      .filter((p): p is ProblemRow => !!p)
      .map((p) => ({ slug: p.slug, title: p.title, difficulty: p.difficulty, tier: p.tier, datasetKey: p.dataset_key, datasetName: getDataset(p.dataset_key)?.name, topics: p.topics, origin: p.origin, status: status[p.id] ?? null }));
  const next = new Date();
  next.setUTCHours(24, 5, 0, 0);
  if (!d.some((s) => s.cadence === 'daily')) void catchUp().catch(() => {});
  return c.json({
    day,
    daily: (await load(d.filter((s) => s.cadence === 'daily').map((s) => s.problem_id)))[0] ?? null,
    weekly: await load(w.filter((s) => s.cadence === 'weekly').map((s) => s.problem_id)),
    monthly: await load(m.filter((s) => s.cadence === 'monthly').map((s) => s.problem_id)),
    nextReleaseAt: next.toISOString(),
  });
});

// ───────── AI tutor ─────────
const aiLimit = rateLimit('AI tutor', 25, 10 * 60_000);

async function problemAndDataset(slug: string) {
  const p = await getProblemBySlug(slug);
  const ds = p ? getDataset(p.dataset_key) : undefined;
  return p && ds ? { p, ds } : null;
}

api.post('/ai/hint', aiLimit, async (c) => {
  const body = z.object({ slug: z.string(), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), sql: z.string().max(20_000).default(''), lastError: z.string().max(2000).optional() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Invalid request'), 400);
  const ctx = await problemAndDataset(body.data.slug);
  if (!ctx) return c.json(bad('Problem not found'), 404);
  return c.json(await hint(ctx.p, ctx.ds, body.data.level, body.data.sql, body.data.lastError));
});

api.post('/ai/explain', aiLimit, async (c) => {
  const body = z
    .object({ slug: z.string(), sql: z.string().max(20_000), error: z.any().optional(), report: z.any().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Invalid request'), 400);
  const ctx = await problemAndDataset(body.data.slug);
  if (!ctx) return c.json(bad('Problem not found'), 404);
  return c.json(await explainFailure(ctx.p, ctx.ds, body.data.sql, body.data.error ?? null, body.data.report));
});

api.post('/ai/review', aiLimit, async (c) => {
  const body = z.object({ slug: z.string(), sql: z.string().max(20_000), report: z.any() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Invalid request'), 400);
  const ctx = await problemAndDataset(body.data.slug);
  if (!ctx) return c.json(bad('Problem not found'), 404);
  if (!(await hasSolved(c.get('identity'), ctx.p.id))) return c.json(bad('Reviews unlock after an accepted submission.'), 403);
  return c.json(await review(ctx.p, ctx.ds, body.data.sql, body.data.report as JudgeReport));
});

api.post('/ai/ask', aiLimit, async (c) => {
  const body = z.object({ slug: z.string(), question: z.string().min(2).max(800), sql: z.string().max(20_000).default('') }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Invalid request'), 400);
  const ctx = await problemAndDataset(body.data.slug);
  if (!ctx) return c.json(bad('Problem not found'), 404);
  try {
    return c.json(await ask(ctx.p, ctx.ds, body.data.question, body.data.sql, await hasSolved(c.get('identity'), ctx.p.id)));
  } catch (e) {
    return c.json(bad((e as Error).message), 503);
  }
});

// ───────── auth & sessions ─────────
const handleSchema = z.string().regex(/^[a-zA-Z0-9_]{3,24}$/, 'Handle: 3–24 letters, digits or _');
const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);
const passwordSchema = z.string().min(1).max(200);
const authLimit = rateLimit('sign-in', 10, 10 * 60_000);
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

const publicUser = (u: { id: number; handle: string; email: string; created_at?: unknown }) => ({ id: u.id, handle: u.handle, email: u.email, createdAt: u.created_at ?? null });

api.post('/auth/register', authLimit, async (c) => {
  const body = z
    .object({ handle: handleSchema, email: emailSchema, password: passwordSchema, ref: z.string().max(40).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad(body.error.issues[0].message), 400);
  const { handle, email, password, ref } = body.data;
  const weak = passwordProblem(password, { email, handle });
  if (weak) return c.json(bad(weak), 400);
  const db = await getDb();
  const exists = await db.query<{ email: string; handle: string }>('SELECT email, handle FROM users WHERE lower(email) = $1 OR lower(handle) = lower($2)', [email, handle]);
  if (exists.rows.length) {
    const takenEmail = exists.rows.some((r) => r.email.toLowerCase() === email);
    return c.json(bad(takenEmail ? 'An account with this email already exists — sign in instead.' : 'That handle is taken.'), 409);
  }
  const res = await db.query<{ id: number; handle: string; email: string; created_at: string }>(
    'INSERT INTO users (handle, email, password_hash, last_login_at) VALUES ($1, $2, $3, now()) RETURNING id, handle, email, created_at',
    [handle, email, await hashPassword(password)]
  );
  const user = res.rows[0];
  await claimGuestProgress(user.id, c.get('identity').clientId);
  if (ref) await db.query('UPDATE users SET referred_by = (SELECT id FROM users WHERE lower(handle) = lower($1) AND id <> $2) WHERE id = $2', [ref, user.id]);
  await startSession(c, user.id);
  void sendWelcome(user).catch(() => {});
  return c.json({ user: publicUser(user) }, 201);
});

api.post('/auth/login', authLimit, async (c) => {
  const body = z.object({ email: emailSchema, password: passwordSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Enter your email and password.'), 400);
  const db = await getDb();
  const res = await db.query<{ id: number; handle: string; email: string; password_hash: string; failed_logins: number; locked_until: Date | string | null; created_at: string }>(
    'SELECT id, handle, email, password_hash, failed_logins, locked_until, created_at FROM users WHERE email = $1',
    [body.data.email]
  );
  const user = res.rows[0];
  // account lockout after repeated failures (on top of per-IP rate limits)
  if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    await burnPasswordCheck(body.data.password);
    return c.json(bad(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'} or reset your password.`), 429);
  }
  // same work whether or not the account exists → no account enumeration via timing
  const valid = user ? await checkPassword(body.data.password, user.password_hash) : await burnPasswordCheck(body.data.password).then(() => false);
  if (!user || !valid) {
    if (user) {
      const fails = user.failed_logins + 1;
      await db.query(
        `UPDATE users SET failed_logins = $2::int, locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) END WHERE id = $1`,
        [user.id, fails >= LOCK_AFTER ? 0 : fails, fails >= LOCK_AFTER, LOCK_MINUTES]
      );
    }
    return c.json(bad('Incorrect email or password.'), 401);
  }
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  await claimGuestProgress(user.id, c.get('identity').clientId);
  await startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

api.post('/auth/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

/** Current session (the web app's single source of truth for "am I signed in?"). */
api.get('/auth/session', (c) => {
  c.header('Cache-Control', 'private, no-store');
  const u = c.get('user');
  return c.json({ user: u ? { id: u.id, handle: u.handle, email: u.email } : null });
});

// Password reset: always answers the same way (no account enumeration); token is single-use, hashed, 30 min.
api.post('/auth/forgot', rateLimit('password reset', 5, 15 * 60_000), async (c) => {
  const body = z.object({ email: emailSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Enter a valid email address.'), 400);
  const db = await getDb();
  const u = await db.query<{ id: number; handle: string; email: string }>('SELECT id, handle, email FROM users WHERE email = $1', [body.data.email]);
  if (u.rows[0]) {
    const token = newToken();
    await db.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`, [tokenHash(token), u.rows[0].id]);
    const link = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${token}`;
    const sent = await sendPasswordReset(u.rows[0], link).catch((e: Error) => ({ sent: 0, error: e.message }));
    if (!sent.sent && !isProd) console.log(`\n🔑 Password reset link for ${u.rows[0].email} (dev — email not delivered: ${sent.error ?? 'unknown'}):\n   ${link}\n`);
  }
  return c.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
});

api.post('/auth/reset', rateLimit('password reset', 10, 15 * 60_000), async (c) => {
  const body = z.object({ token: z.string().min(20).max(100), password: passwordSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Invalid reset request.'), 400);
  const db = await getDb();
  const r = await db.query<{ id: number; user_id: number; email: string; handle: string }>(
    `SELECT pr.id, pr.user_id, u.email, u.handle FROM password_resets pr JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()`,
    [tokenHash(body.data.token)]
  );
  const row = r.rows[0];
  if (!row) return c.json(bad('This reset link is invalid or has expired. Request a new one.'), 400);
  const weak = passwordProblem(body.data.password, row);
  if (weak) return c.json(bad(weak), 400);
  await db.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [row.id]);
  await db.query('UPDATE users SET password_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1', [row.user_id, await hashPassword(body.data.password)]);
  await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [row.user_id]);
  await startSession(c, row.user_id);
  void sendPasswordChanged({ id: row.user_id, handle: row.handle, email: row.email }, { ip: clientIp(c), userAgent: c.req.header('user-agent'), via: 'reset' }).catch(() => {});
  return c.json({ ok: true });
});

// ───────── account (all require a session) ─────────
api.get('/me', (c) => {
  const u = c.get('user');
  return c.json({ user: u ? { id: u.id, handle: u.handle, email: u.email } : null });
});

api.get('/me/sessions', async (c) => {
  const u = c.get('user')!;
  const db = await getDb();
  const r = await db.query<{ id: number; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null }>(
    `SELECT id, created_at, last_seen_at, ip, user_agent FROM auth_sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC LIMIT 20`,
    [u.id]
  );
  const mask = (ip: string | null) => (ip ? ip.replace(/(\d+\.\d+)\.\d+\.\d+$/, '$1.•.•').replace(/:[0-9a-f]*:[0-9a-f]*$/i, ':•:•') : null);
  return c.json(r.rows.map((s) => ({ id: s.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at, ip: mask(s.ip), userAgent: s.user_agent, current: s.id === u.sessionId })));
});

api.delete('/me/sessions/:id', async (c) => {
  const u = c.get('user')!;
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id)) return c.json(bad('Invalid session'), 400);
  const db = await getDb();
  await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [id, u.id]);
  if (id === u.sessionId) clearSessionCookie(c);
  return c.json({ ok: true });
});

api.post('/me/sessions/revoke-others', async (c) => {
  const u = c.get('user')!;
  const db = await getDb();
  const r = await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL RETURNING id', [u.id, u.sessionId]);
  return c.json({ ok: true, revoked: r.rows.length });
});

api.put('/me/password', rateLimit('password change', 5, 15 * 60_000), async (c) => {
  const u = c.get('user')!;
  const body = z.object({ current: passwordSchema, next: passwordSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Enter your current and new password.'), 400);
  const db = await getDb();
  const r = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [u.id]);
  if (!(await checkPassword(body.data.current, r.rows[0].password_hash))) return c.json(bad('Current password is incorrect.'), 400);
  const weak = passwordProblem(body.data.next, u);
  if (weak) return c.json(bad(weak), 400);
  await db.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [u.id, await hashPassword(body.data.next)]);
  // every other device is signed out; this one gets a brand-new session
  await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
  await startSession(c, u.id);
  void sendPasswordChanged(u, { ip: clientIp(c), userAgent: c.req.header('user-agent'), via: 'settings' }).catch(() => {});
  return c.json({ ok: true });
});

api.get('/me/account', async (c) => {
  const u = c.get('user')!;
  const db = await getDb();
  const r = await db.query<{ email_opt_in: boolean; created_at: string; last_login_at: string | null; password_changed_at: string | null }>(
    'SELECT email_opt_in, created_at, last_login_at, password_changed_at FROM users WHERE id = $1',
    [u.id]
  );
  return c.json({ handle: u.handle, email: u.email, ...r.rows[0] });
});

api.get('/me/stats', async (c) => {
  const id = c.get('identity');
  if (!id.userId && !id.clientId) return c.json({ solved: {}, totals: {}, heatmap: [], topics: [], streak: 0 });
  return c.json(await profileStats(id));
});

const prefsSchema = z.object({
  level: z.enum(['new', 'some', 'pro']).optional(),
  domains: z.array(z.string()).max(9).optional(),
  goal: z.string().max(60).optional(),
});

api.get('/me/next', async (c) => {
  const id = c.get('identity');
  let prefs: z.infer<typeof prefsSchema> = {};
  if (id.userId) {
    const db = await getDb();
    const r = await db.query<{ onboarding: unknown }>('SELECT onboarding FROM users WHERE id = $1', [id.userId]);
    const raw = r.rows[0]?.onboarding;
    prefs = prefsSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw).data ?? {};
  } else {
    prefs = prefsSchema.safeParse({ level: c.req.query('level'), domains: c.req.query('domains')?.split(',').filter(Boolean) }).data ?? {};
  }
  return c.json(await recommendations(id, prefs));
});

api.put('/me/onboarding', async (c) => {
  const id = c.get('identity');
  if (!id.userId) return c.json(bad('Sign in required'), 401);
  const body = prefsSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Invalid preferences'), 400);
  const db = await getDb();
  await db.query('UPDATE users SET onboarding = $2::jsonb WHERE id = $1', [id.userId, JSON.stringify(body.data)]);
  return c.json({ ok: true });
});

api.get('/me/referrals', async (c) => {
  const id = c.get('identity');
  if (!id.userId) return c.json(bad('Sign in required'), 401);
  const db = await getDb();
  const res = await db.query<{ handle: string; created_at: string; solved: number }>(
    `SELECT u.handle, u.created_at,
            (SELECT COUNT(DISTINCT problem_id)::int FROM submissions s WHERE s.user_id = u.id AND s.verdict = 'ACCEPTED') AS solved
     FROM users u WHERE u.referred_by = $1 ORDER BY u.created_at DESC`,
    [id.userId]
  );
  return c.json({ handle: c.get('handle'), invited: res.rows });
});

api.put('/me/email', async (c) => {
  const id = c.get('identity');
  if (!id.userId) return c.json(bad('Sign in required'), 401);
  const body = z.object({ optIn: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json(bad('Invalid request'), 400);
  const db = await getDb();
  await db.query('UPDATE users SET email_opt_in = $2 WHERE id = $1', [id.userId, body.data.optIn]);
  return c.json({ ok: true });
});

// Unsubscribe: GET shows a confirm page (link scanners must not unsubscribe people);
// POST does it — from that page's button or from Gmail/Apple Mail's one-click header (RFC 8058).
const unsubPage = (inner: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Email preferences · Querion</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#07080b;color:#eef1f7;font-family:Inter,'Segoe UI',Roboto,Arial,sans-serif;padding:16px">
<div style="max-width:420px;width:100%;background:#10131a;border:1px solid #212634;border-radius:14px;padding:28px"><div style="font-weight:700;margin-bottom:16px"><span style="color:#d4ff3a">✦</span> Querion</div>${inner}</div></body></html>`;

const unsubTarget = (c: { req: { query: (k: string) => string | undefined } }) => {
  const uid = Number(c.req.query('u'));
  const token = c.req.query('t') ?? '';
  return Number.isSafeInteger(uid) && uid > 0 && verifyUnsub(uid, token) ? { uid, token } : null;
};

api.get('/mail/unsubscribe', (c) => {
  const t = unsubTarget(c);
  if (!t) return c.html(unsubPage('<p style="color:#9ca5b8">This unsubscribe link is invalid. You can manage emails in Settings.</p>'), 400);
  return c.html(
    unsubPage(`<h1 style="font-size:20px;margin:0 0 8px">Stop weekly emails?</h1>
<p style="color:#9ca5b8;margin:0 0 20px;line-height:1.6">You'll stop getting the weekly problem pack. Account and security emails still arrive.</p>
<form method="post" action="/api/mail/unsubscribe?u=${t.uid}&t=${esc(t.token)}"><button style="background:#d4ff3a;color:#0b0f00;border:0;border-radius:10px;padding:11px 18px;font-weight:700;font-size:15px;cursor:pointer">Unsubscribe</button></form>`)
  );
});

api.post('/mail/unsubscribe', async (c) => {
  const t = unsubTarget(c);
  if (!t) return c.html(unsubPage('<p style="color:#9ca5b8">This unsubscribe link is invalid.</p>'), 400);
  const db = await getDb();
  await db.query('UPDATE users SET email_opt_in = false WHERE id = $1', [t.uid]);
  return c.html(unsubPage(`<h1 style="font-size:20px;margin:0 0 8px">You're unsubscribed</h1><p style="color:#9ca5b8;margin:0;line-height:1.6">No more weekly emails. You can turn them back on any time in <a href="${env.APP_URL.replace(/\/$/, '')}/settings" style="color:#7d9bff">Settings</a>.</p>`));
});

/** Public, anonymised weekly learning insights (also shown on the landing page). */
api.get('/insights', async (c) => c.json(await latestInsights()));

// ───────── automation hooks (GitHub Actions / n8n / cron-job.org) ─────────
const hooks = new Hono<Env>();
hooks.use('*', async (c, next) => {
  if (!safeEqual(c.req.header('x-cron-secret'), env.CRON_SECRET)) return c.json(bad('Forbidden'), 403);
  await next();
});
hooks.post('/daily', async (c) => {
  void ensureDaily().catch((e) => console.error(e));
  return c.json({ accepted: true }, 202);
});
hooks.post('/weekly', async (c) => {
  const week = c.req.query('week') ?? nextMonday(today());
  void runWeekly(week).catch((e) => console.error(e));
  return c.json({ accepted: true, week }, 202);
});
api.route('/hooks', hooks);

// ───────── admin (Nebula ops) ─────────
const admin = new Hono<Env>();
admin.use('*', async (c, next) => {
  if (!safeEqual(c.req.header('x-admin-token'), env.ADMIN_TOKEN)) return c.json(bad('Forbidden'), 403);
  await next();
});
admin.post('/forge', async (c) => {
  const body = z
    .object({ cadence: z.enum(['daily', 'weekly', 'monthly', 'core']).default('core'), datasetKey: z.string().optional(), difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(), topic: z.string().optional() })
    .parse(await c.req.json().catch(() => ({})));
  const out = await forgeProblem({ ...body, date: today() });
  return c.json({ problem: out.problem ? { slug: out.problem.slug, title: out.problem.title } : null, log: out.log });
});
admin.post('/release', async (c) => {
  await catchUp();
  return c.json({ ok: true });
});
admin.post('/kaggle-sync', async (c) => c.json(await kaggleSync()));
admin.post('/scout', async (c) => c.json(await scout({ week: mondayOf(today()), domain: c.req.query('domain') as never })));
admin.get('/runs', async (c) => {
  const db = await getDb();
  const res = await db.query('SELECT * FROM forge_runs ORDER BY id DESC LIMIT 50');
  return c.json(res.rows);
});
api.route('/admin', admin);

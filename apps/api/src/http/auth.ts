import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getDb } from '../db';
import type { Identity } from '../db/repo';
import { env, isProd } from '../env';

/*
 * Session model
 * ─────────────
 * • Login creates an opaque 256-bit random token, sent ONLY as an httpOnly cookie
 *   (JavaScript can never read it → XSS cannot steal sessions).
 * • In production the cookie is `__Host-qn_session`: Secure, Path=/, no Domain —
 *   browsers refuse to set it over HTTP or for any other (sub)domain.
 * • SameSite=Lax + a required custom header on every state-changing request
 *   (X-Querion-CSRF) → cross-site requests can't ride the session (CSRF).
 * • The DB stores HMAC-SHA256(token, JWT_SECRET), never the token. A database
 *   leak can't be replayed as a login.
 * • Sessions slide: 30 days idle timeout, 90 days absolute maximum, revocable
 *   individually, all at once, and automatically on password change.
 */

export const COOKIE = isProd ? '__Host-qn_session' : 'qn_session';
const IDLE_DAYS = 30;
const ABSOLUTE_DAYS = 90;
const TOUCH_EVERY_MS = 15 * 60_000;

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
/** Burned on unknown emails so login takes the same time either way (no account enumeration via timing). */
const DUMMY_HASH = bcrypt.hashSync('querion-timing-equaliser', 12);
export const burnPasswordCheck = (pw: string) => bcrypt.compare(pw, DUMMY_HASH);

const hmac = (token: string) => crypto.createHmac('sha256', env.JWT_SECRET).update(token).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenHash = hmac;

/** Constant-time comparison for shared secrets (admin token, cron secret). */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * Client IP for rate limiting, resistant to spoofing:
 *  1. our own edge proxy (Cloudflare Pages Function) vouches for the visitor IP with PROXY_SECRET;
 *  2. otherwise the LAST X-Forwarded-For hop — the one appended by the host's own load balancer
 *     (the first hop is whatever the client claimed, so it can't be trusted);
 *  3. otherwise the socket address.
 */
export function clientIp(c: Context): string {
  const vouched = c.req.header('x-querion-client-ip');
  if (vouched && env.PROXY_SECRET && safeEqual(c.req.header('x-proxy-secret'), env.PROXY_SECRET)) return vouched.slice(0, 64);
  const hops = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean);
  const fwd = hops?.length ? hops[hops.length - 1] : null;
  if (fwd) return fwd.slice(0, 64);
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function writeCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'Lax',
    path: '/',
    maxAge: IDLE_DAYS * 86400,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE, { path: '/', secure: isProd });
}

/** Creates a fresh session (always a new token → no session fixation) and sets the cookie. */
export async function startSession(c: Context, userId: number) {
  const db = await getDb();
  // rotate: if this browser already had a session, revoke it
  const prev = getCookie(c, COOKIE);
  if (prev) await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hmac(prev)]);
  const token = newToken();
  await db.query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [hmac(token), userId, IDLE_DAYS, clientIp(c), (c.req.header('user-agent') ?? '').slice(0, 200)]
  );
  writeCookie(c, token);
}

export async function endSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) {
    const db = await getDb();
    await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hmac(token)]);
  }
  clearSessionCookie(c);
}

export type SessionUser = { id: number; handle: string; email: string; sessionId: number };
export type Env = { Variables: { identity: Identity; handle: string | null; user: SessionUser | null } };

/** Resolves the caller from the session cookie (or anonymous X-Client-Id for rate limiting). */
export const identify: MiddlewareHandler<Env> = async (c, next) => {
  let user: SessionUser | null = null;
  const token = getCookie(c, COOKIE);
  if (token && token.length >= 40 && token.length <= 64) {
    const db = await getDb();
    const r = await db.query<{ sid: number; user_id: number; handle: string; email: string; last_seen_at: Date | string; created_at: Date | string }>(
      `SELECT s.id AS sid, s.user_id, u.handle, u.email, s.last_seen_at, s.created_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND s.created_at > now() - make_interval(days => $2)`,
      [hmac(token), ABSOLUTE_DAYS]
    );
    const s = r.rows[0];
    if (s) {
      user = { id: s.user_id, handle: s.handle, email: s.email, sessionId: s.sid };
      // sliding expiry, written at most every 15 min
      if (Date.now() - new Date(s.last_seen_at).getTime() > TOUCH_EVERY_MS) {
        await db.query(`UPDATE auth_sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1`, [s.sid, IDLE_DAYS]);
        writeCookie(c, token);
      }
    } else {
      clearSessionCookie(c); // stale/revoked cookie
    }
  }
  const raw = c.req.header('x-client-id');
  const clientId = raw && /^[a-zA-Z0-9_-]{8,64}$/.test(raw) ? raw : null;
  c.set('user', user);
  c.set('identity', { userId: user?.id ?? null, clientId });
  c.set('handle', user?.handle ?? null);
  await next();
};

/**
 * CSRF defence for cookie-authenticated, state-changing requests: require our custom
 * header (cross-site forms/fetches can't set it without a CORS preflight, which we
 * only allow for our own origins) and, when the browser sends Origin, require a match.
 */
export function csrfGuard(allowedOrigins: string[]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const m = c.req.method;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
    if (c.req.path.startsWith('/api/hooks/') || c.req.path.startsWith('/api/admin/')) return next(); // secret-header auth, no cookies
    if (c.req.path === '/api/mail/unsubscribe') return next(); // HMAC-signed link, no cookies; mail clients POST it (RFC 8058)
    if (c.req.header('x-querion-csrf') !== '1') return c.json({ error: 'Missing CSRF header.' }, 403);
    const origin = c.req.header('origin');
    if (origin) {
      const self = new URL(c.req.url).origin;
      const ok = origin === self || allowedOrigins.includes(origin) || (!isProd && /^http:\/\/localhost:\d+$/.test(origin));
      if (!ok) return c.json({ error: 'Cross-site request blocked.' }, 403);
    }
    await next();
  };
}

/** Route guard: 401 unless a valid session is present. */
export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'Please sign in to continue.' }, 401);
  await next();
};

/**
 * Fixed-window rate limiter applied to BOTH the caller identity and the IP.
 * The identity bucket gives fair per-learner limits; the IP bucket (looser, ×4)
 * stops anyone from bypassing limits by rotating identifiers.
 */
export function rateLimit(name: string, max: number, windowMs: number): MiddlewareHandler<Env> {
  const hits = new Map<string, { n: number; reset: number }>();
  const bump = (key: string, limit: number, now: number) => {
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      return null;
    }
    return ++h.n > limit ? h.reset : null;
  };
  return async (c, next) => {
    const id = c.get('identity');
    const now = Date.now();
    const ip = clientIp(c);
    const who = id?.userId ? `u${id.userId}` : id?.clientId ? `c${id.clientId}` : `i${ip}`;
    const blocked = bump(`id:${who}`, max, now) ?? bump(`ip:${ip}`, max * 4, now);
    if (blocked) {
      c.header('Retry-After', String(Math.ceil((blocked - now) / 1000)));
      return c.json({ error: `Slow down — ${name} limit is ${max} per ${Math.max(1, Math.round(windowMs / 60000))} min.` }, 429);
    }
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    await next();
  };
}

/** Basic password policy: length, not trivially guessable, not derived from the account. */
const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', 'qwerty123', 'iloveyou', 'letmein123', 'admin123', 'welcome1', '11111111', 'abc12345', 'querion123', 'sql12345', 'passw0rd']);
export function passwordProblem(pw: string, ctx: { email?: string; handle?: string }): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (Buffer.byteLength(pw) > 72) return 'Password is too long (72 bytes max).';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common — pick something less guessable.';
  if (/^(.)\1+$/.test(pw)) return 'Avoid repeating a single character.';
  const lower = pw.toLowerCase();
  if (ctx.handle && ctx.handle.length >= 3 && lower.includes(ctx.handle.toLowerCase())) return "Don't include your handle in the password.";
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) return "Don't include your email in the password.";
  if (!/[a-z]/i.test(pw) || !/[\d\W_]/.test(pw)) return 'Mix letters with at least one number or symbol.';
  return null;
}

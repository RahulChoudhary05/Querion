import crypto from 'node:crypto';
import { getDb } from '../db';
import { env } from '../env';

/**
 * Email through Resend (free tier: 3,000/month, 100/day).
 *
 *   • transactional — welcome, password reset, password changed  → POST /emails (one at a time)
 *   • digest        — weekly "new problems" pack                  → POST /emails/batch (≤100 per call)
 *
 * Every send is best-effort: a missing key or an API error never breaks a request,
 * but failures are logged with Resend's real error message (no more silent drops).
 *
 * Note: with the default sender `onboarding@resend.dev` Resend only delivers to the
 * Resend account owner's own inbox. Verify a domain at resend.com/domains and set
 * MAIL_FROM="Querion <no-reply@your-domain>" to email everyone.
 */

export const mailEnabled = () => !!env.RESEND_API_KEY;
export const sandboxSender = () => /@resend\.dev>?\s*$/i.test(env.MAIL_FROM);

const app = () => env.APP_URL.replace(/\/$/, '');

// ───────── unsubscribe (HMAC-signed, no login needed) ─────────
const sign = (userId: number) => crypto.createHmac('sha256', env.JWT_SECRET).update(`unsub:${userId}`).digest('hex').slice(0, 32);
export const verifyUnsub = (userId: number, token: string) => {
  const expected = sign(userId);
  return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
};
export const unsubLink = (userId: number) => `${app()}/api/mail/unsubscribe?u=${userId}&t=${sign(userId)}`;

// ───────── templates (table layout + inline styles: works in Gmail, Outlook, Apple Mail) ─────────
const C = { bg: '#07080b', panel: '#10131a', border: '#212634', text: '#eef1f7', muted: '#9ca5b8', faint: '#5c6578', cobalt: '#7d9bff', cta: '#d4ff3a', ctaInk: '#0b0f00' };

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Content {
  preheader: string; // inbox preview line
  title: string;
  html: string; // body HTML (already escaped)
  text: string; // plain-text body
  cta?: { href: string; label: string };
  footnote?: string; // small print under the button (plain text)
  unsubscribeFor?: number; // user id → adds an unsubscribe link (digests only)
}

function render(m: Content) {
  const unsub = m.unsubscribeFor ? unsubLink(m.unsubscribeFor) : null;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(m.title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.text};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:36px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 18px;font-size:17px;font-weight:700;letter-spacing:-.01em;color:${C.text}"><span style="color:${C.cta}">✦</span>&nbsp;Querion</td></tr>
<tr><td style="background:${C.panel};border:1px solid ${C.border};border-radius:14px;padding:32px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.02em;color:${C.text}">${esc(m.title)}</h1>
<div style="font-size:15px;line-height:1.65;color:${C.muted}">${m.html}</div>
${m.cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td style="border-radius:10px;background:${C.cta}"><a href="${esc(m.cta.href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:${C.ctaInk};text-decoration:none;border-radius:10px">${esc(m.cta.label)} →</a></td></tr></table>
<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${C.faint}">Button not working? Paste this link into your browser:<br><a href="${esc(m.cta.href)}" style="color:${C.cobalt};word-break:break-all">${esc(m.cta.href)}</a></p>` : ''}
${m.footnote ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${C.faint}">${esc(m.footnote)}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 4px 0;font-size:12px;line-height:1.6;color:${C.faint}">Querion · Master SQL on real data · <a href="${app()}" style="color:${C.faint}">${esc(app().replace(/^https?:\/\//, ''))}</a>${unsub ? `<br><a href="${unsub}" style="color:${C.faint}">Unsubscribe from weekly emails</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    m.title,
    '',
    m.text,
    m.cta ? `\n${m.cta.label}: ${m.cta.href}` : '',
    m.footnote ? `\n${m.footnote}` : '',
    '\n— Querion',
    unsub ? `\nUnsubscribe from weekly emails: ${unsub}` : '',
  ]
    .filter((x) => x !== '')
    .join('\n');
  return { html, text };
}

// ───────── transport ─────────
interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}
export interface SendResult {
  sent: number;
  failed: number;
  error?: string;
  ids?: string[];
}

let warnedSandbox = false;
function explain(status: number, body: string) {
  let msg = body;
  try {
    msg = (JSON.parse(body) as { message?: string }).message ?? body;
  } catch {
    /* not JSON */
  }
  if (status === 403 && /only send testing emails/i.test(msg) && !warnedSandbox) {
    warnedSandbox = true;
    console.warn(
      '\n✉️  Resend sandbox: with MAIL_FROM on resend.dev, mail is only delivered to your Resend account email.\n' +
        '   Verify a domain at https://resend.com/domains, then set MAIL_FROM="Querion <no-reply@your-domain>".\n'
    );
  }
  return `${status} ${msg}`.slice(0, 300);
}

async function post(path: '/emails' | '/emails/batch', payload: unknown, idempotencyKey?: string) {
  try {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false as const, error: explain(res.status, body) };
    const data = JSON.parse(body) as { id?: string; data?: { id: string }[] };
    return { ok: true as const, ids: data.id ? [data.id] : (data.data ?? []).map((d) => d.id) };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

const withFrom = (m: Mail) => ({ from: env.MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.headers ? { headers: m.headers } : {}) });

/** One transactional email. */
export async function sendOne(m: Mail, idempotencyKey?: string): Promise<SendResult> {
  if (!mailEnabled()) return { sent: 0, failed: 0, error: 'RESEND_API_KEY is not set' };
  const r = await post('/emails', withFrom(m), idempotencyKey);
  if (!r.ok) console.warn(`✉️  Resend: "${m.subject}" to ${m.to} failed — ${r.error}`);
  return r.ok ? { sent: 1, failed: 0, ids: r.ids } : { sent: 0, failed: 1, error: r.error };
}

/** Many emails, 100 per Resend batch call. */
export async function sendMany(messages: Mail[], idempotencyPrefix?: string): Promise<SendResult> {
  if (!mailEnabled()) return { sent: 0, failed: messages.length, error: 'RESEND_API_KEY is not set' };
  const out: SendResult = { sent: 0, failed: 0, ids: [] };
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const r = await post('/emails/batch', chunk.map(withFrom), idempotencyPrefix ? `${idempotencyPrefix}-${i / 100}` : undefined);
    if (r.ok) {
      out.sent += chunk.length;
      out.ids!.push(...r.ids);
    } else {
      out.failed += chunk.length;
      out.error = r.error;
      console.warn(`✉️  Resend batch (${chunk.length} emails) failed — ${r.error}`);
    }
  }
  return out;
}

const listHeaders = (userId: number) => ({
  'List-Unsubscribe': `<${unsubLink(userId)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

// ───────── the emails ─────────
type User = { id: number; handle: string; email: string };

export function welcomeEmail(user: User): Mail {
  const c = render({
    preheader: 'Real PostgreSQL in your browser, fresh problems every week.',
    title: `Welcome to Querion, ${user.handle}`,
    html: `<p style="margin:0 0 12px">Your account is ready. Querion runs real PostgreSQL right in your browser, and every answer is judged against hidden test data, just like an interview.</p>
<p style="margin:0 0 6px;color:${C.text};font-weight:600">A good first hour</p>
<ol style="margin:0;padding-left:20px">
<li style="margin:4px 0">Pick a track (transport, cars, e-commerce, engineering…)</li>
<li style="margin:4px 0">Clear Tier 1, then climb toward Architect-level problems</li>
<li style="margin:4px 0">Come back Sunday for a fresh pack forged from new Kaggle data</li>
</ol>`,
    text: `Your account is ready. Querion runs real PostgreSQL right in your browser, and every answer is judged against hidden test data.

A good first hour:
1. Pick a track (transport, cars, e-commerce, engineering…)
2. Clear Tier 1, then climb toward Architect-level problems
3. Come back Sunday for a fresh pack forged from new Kaggle data`,
    cta: { href: `${app()}/dashboard`, label: 'Open your dashboard' },
    unsubscribeFor: user.id,
  });
  return { to: user.email, subject: 'Welcome to Querion. Your first query awaits', ...c, headers: listHeaders(user.id) };
}

export function passwordResetEmail(user: User, link: string): Mail {
  const c = render({
    preheader: 'This link works once and expires in 30 minutes.',
    title: 'Reset your password',
    html: `<p style="margin:0 0 12px">Hi ${esc(user.handle)}, we got a request to reset the password for your Querion account.</p>
<p style="margin:0">The link works once and expires in <b style="color:${C.text}">30 minutes</b>.</p>`,
    text: `Hi ${user.handle}, we got a request to reset the password for your Querion account.\nThe link works once and expires in 30 minutes.`,
    cta: { href: link, label: 'Choose a new password' },
    footnote: "Didn't ask for this? Ignore this email. Your password stays the same.",
  });
  return { to: user.email, subject: 'Reset your Querion password', ...c };
}

export function passwordChangedEmail(user: User, info: { ip?: string | null; userAgent?: string | null; via: 'reset' | 'settings' }): Mail {
  const when = new Date().toUTCString();
  const device = [info.userAgent ? describeAgent(info.userAgent) : null, info.ip ? `IP ${info.ip}` : null].filter(Boolean).join(' · ');
  const c = render({
    preheader: 'Your Querion password was just changed.',
    title: 'Your password was changed',
    html: `<p style="margin:0 0 12px">Hi ${esc(user.handle)}, the password for your Querion account was changed ${info.via === 'reset' ? 'using a reset link' : 'from Settings'}.</p>
<p style="margin:0 0 12px;font-size:13px;color:${C.faint}">${esc(when)}${device ? `<br>${esc(device)}` : ''}</p>
<p style="margin:0">All other devices were signed out. If this was you, there's nothing to do.</p>`,
    text: `Hi ${user.handle}, the password for your Querion account was changed ${info.via === 'reset' ? 'using a reset link' : 'from Settings'}.\n${when}${device ? `\n${device}` : ''}\n\nAll other devices were signed out. If this was you, there's nothing to do.`,
    cta: { href: `${app()}/forgot-password`, label: "Wasn't me: secure my account" },
  });
  return { to: user.email, subject: 'Your Querion password was changed', ...c };
}

function describeAgent(ua: string) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

type PackItem = { slug: string; title: string; difficulty: string; tier: number; segment?: string | null };

export function weeklyDigestEmail(user: User & { solved: number }, week: string, pack: PackItem[]): Mail {
  const tierName = (t: number) => ['', 'Foundations', 'Aggregation', 'Relationships', 'Composition', 'Analytics', 'Architect'][t] ?? `Tier ${t}`;
  const rows = pack
    .map(
      (p) => `<tr><td style="padding:12px 0;border-top:1px solid ${C.border}">
<a href="${app()}/p/${esc(p.slug)}" style="color:${C.text};font-weight:600;text-decoration:none">${esc(p.title)}</a>
<div style="font-size:12px;color:${C.faint};margin-top:3px">Tier ${p.tier} · ${esc(tierName(p.tier))} · ${esc(p.difficulty)}${p.segment ? ` · ${esc(p.segment)}` : ''}</div></td></tr>`
    )
    .join('');
  const c = render({
    preheader: `${pack.length} new problems forged from fresh data, Easy to Architect.`,
    title: `${pack.length} fresh problems for the week of ${week}`,
    html: `<p style="margin:0 0 14px">Hi ${esc(user.handle)}, you've solved <b style="color:${C.text}">${user.solved}</b> problem${user.solved === 1 ? '' : 's'} so far. This week's pack was built from new data and tuned to where learners got stuck last week.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
    text: `Hi ${user.handle}, you've solved ${user.solved} problem${user.solved === 1 ? '' : 's'} so far. This week's pack:\n\n${pack.map((p) => `• ${p.title} (Tier ${p.tier}, ${p.difficulty})\n  ${app()}/p/${p.slug}`).join('\n')}`,
    cta: { href: `${app()}/problems?cadence=weekly`, label: 'Start the week' },
    unsubscribeFor: user.id,
  });
  return { to: user.email, subject: `This week on Querion: ${pack.length} fresh SQL problems`, ...c, headers: listHeaders(user.id) };
}

export function testEmail(to: string): Mail {
  const c = render({
    preheader: 'If you can read this, Resend is wired up correctly.',
    title: 'Email is working',
    html: `<p style="margin:0">If you can read this, Querion's Resend integration is wired up correctly.</p><p style="margin:12px 0 0;font-size:13px;color:${C.faint}">Sender: ${esc(env.MAIL_FROM)}<br>App URL: ${esc(app())}</p>`,
    text: `If you can read this, Querion's Resend integration is wired up correctly.\nSender: ${env.MAIL_FROM}\nApp URL: ${app()}`,
    cta: { href: app(), label: 'Open Querion' },
  });
  return { to, subject: 'Querion test email', ...c };
}

// ───────── senders used by routes / scheduler ─────────
export const sendWelcome = (user: User) => sendOne(welcomeEmail(user), `welcome-${user.id}`);
export const sendPasswordReset = (user: User, link: string) => sendOne(passwordResetEmail(user, link));
export const sendPasswordChanged = (user: User, info: Parameters<typeof passwordChangedEmail>[1]) => sendOne(passwordChangedEmail(user, info));

/** Weekly digest of the new pack, sent once per week to opted-in users. Idempotent per week for 24h. */
export async function sendWeeklyDigest(week: string): Promise<SendResult> {
  if (!mailEnabled()) return { sent: 0, failed: 0, error: 'RESEND_API_KEY is not set' };
  const db = await getDb();
  const pack = await db.query<PackItem>(
    `SELECT p.slug, p.title, p.difficulty, p.tier FROM schedule s JOIN problems p ON p.id = s.problem_id
     WHERE s.day = $1 AND s.cadence = 'weekly' ORDER BY p.tier, p.id`,
    [week]
  );
  if (!pack.rows.length) return { sent: 0, failed: 0 };
  const users = await db.query<User & { solved: number }>(
    `SELECT u.id, u.handle, u.email,
            (SELECT COUNT(DISTINCT problem_id)::int FROM submissions s WHERE s.user_id = u.id AND s.verdict = 'ACCEPTED') AS solved
     FROM users u WHERE u.email_opt_in ORDER BY u.id`
  );
  return sendMany(
    users.rows.map((u) => weeklyDigestEmail(u, week, pack.rows)),
    `weekly-${week}`
  );
}

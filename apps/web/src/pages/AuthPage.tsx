import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useAnimate } from 'motion/react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, EyeOff, Lock, MailCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Logo, LogoMark } from '../components/Logo';
import { PixelField } from '../components/PixelField';
import { safeNext } from '../components/RequireAuth';
import { Seo } from '../components/Seo';
import { Button, cx } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { SESSION_KEY, type SessionUser } from '../lib/session';
import { useApp } from '../lib/store';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

const modeFromPath = (p: string): Mode => (p.startsWith('/signup') ? 'signup' : p.startsWith('/forgot') ? 'forgot' : p.startsWith('/reset') ? 'reset' : 'login');

const COPY: Record<Mode, { title: string; sub: string; seo: string }> = {
  login: { title: 'Welcome back', sub: 'Sign in to continue your streak.', seo: 'Sign in' },
  signup: { title: 'Start practising on real data', sub: 'Free forever. No card, no catch.', seo: 'Create your free account' },
  forgot: { title: 'Reset your password', sub: "We'll email you a secure, single-use link.", seo: 'Reset password' },
  reset: { title: 'Choose a new password', sub: 'Every other device will be signed out.', seo: 'Choose a new password' },
};

// ───────── password strength (client-side guidance; the server enforces the real policy) ─────────
function strength(pw: string) {
  const checks = [
    { ok: pw.length >= 8, label: '8+ characters' },
    { ok: /[a-z]/i.test(pw) && /[\d\W_]/.test(pw), label: 'Letters and a number or symbol' },
    { ok: pw.length >= 12 || (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /\W/.test(pw)), label: '12+ characters or a mix of cases & symbols' },
  ];
  const score = pw ? checks.filter((c) => c.ok).length + (pw.length >= 16 ? 1 : 0) : 0;
  return { checks, score: Math.min(score, 4) };
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  error,
  autoFocus,
  right,
  name,
  onKeyEvent,
  hint,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  error?: string | null;
  autoFocus?: boolean;
  right?: ReactNode;
  name: string;
  onKeyEvent?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  hint?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-ink/90">
        {label}
        {hint}
      </span>
      <div className="relative">
        <input
          name={name}
          type={type}
          value={value}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={onKeyEvent}
          onKeyDown={onKeyEvent}
          aria-invalid={!!error}
          className={cx(
            'h-11 w-full rounded-lg border bg-bg/70 px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-faint',
            'focus:border-accent/70 focus:shadow-[0_0_0_4px_rgba(47,91,255,0.18)]',
            error ? 'border-bad/60' : 'border-line-strong',
            right && 'pr-11'
          )}
        />
        {right && <div className="absolute inset-y-0 right-0 flex items-center pr-2">{right}</div>}
      </div>
      <AnimatePresence initial={false}>
        {error && (
          <motion.span initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-1.5 flex items-center gap-1 text-xs text-bad">
            <AlertCircle className="size-3" /> {error}
          </motion.span>
        )}
      </AnimatePresence>
    </label>
  );
}

function PasswordInput(props: Omit<Parameters<typeof Field>[0], 'type' | 'right' | 'onKeyEvent'> & { capsHint?: boolean }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <>
      <Field
        {...props}
        type={show ? 'text' : 'password'}
        onKeyEvent={(e) => setCaps(e.getModifierState?.('CapsLock') ?? false)}
        right={
          <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)} className="grid size-8 place-items-center rounded-md text-faint hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        }
      />
      {caps && <div className="mt-1 text-xs text-warn">Caps Lock is on</div>}
    </>
  );
}

// ───────── showcase (live renders, not screenshots) ─────────
const SHOWCASE = [
  {
    kicker: 'Real PostgreSQL 17, in your browser',
    title: 'Run queries instantly. Nothing leaves your machine.',
    body: (
      <div className="font-mono text-[12px] leading-[1.7]">
        <div><span className="text-accent">SELECT</span> route_code, <span className="text-accent-2">COUNT</span>(*) <span className="text-accent">AS</span> trips</div>
        <div><span className="text-accent">FROM</span> trips <span className="text-accent">JOIN</span> routes <span className="text-accent">USING</span> (route_id)</div>
        <div><span className="text-accent">GROUP BY</span> 1 <span className="text-accent">ORDER BY</span> 2 <span className="text-accent">DESC</span>;</div>
        <div className="mt-3 overflow-hidden rounded-md border border-line">
          {[['R7', 41], ['R1', 39], ['R4', 33]].map(([r, n], i) => (
            <div key={r as string} className={cx('flex justify-between px-3 py-1.5', i && 'border-t border-line/70')}>
              <span>{r}</span>
              <span className="tabular-nums text-muted">{n}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-faint">3 rows · 2.4 ms · pg17-wasm</div>
      </div>
    ),
  },
  {
    kicker: 'Judged like an interview',
    title: 'Correct on data you never see — and fast.',
    body: (
      <div className="space-y-2 font-mono text-[12px]">
        {['Sample data', 'Shuffled storage order', 'Sparse data', 'Ties & duplicates'].map((t, i) => (
          <motion.div key={t} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.12 }} className="flex items-center gap-2 rounded-md border border-ok/25 bg-ok/[0.06] px-3 py-2">
            <CheckCircle2 className="size-3.5 text-ok" />
            <span className="text-ink/85">{t}</span>
            {i > 0 && <span className="ml-auto text-faint">hidden</span>}
          </motion.div>
        ))}
        <div className="flex items-center justify-between pt-1 text-[11px]">
          <span className="text-ok">Accepted · 4/4</span>
          <span className="text-faint">plan cost 212 / budget 340</span>
        </div>
      </div>
    ),
  },
  {
    kicker: 'Fresh problems every week',
    title: 'An AI agent turns new Kaggle data into verified problems.',
    body: (
      <div className="space-y-1.5 font-mono text-[12px]">
        {['scout Kaggle · NYC taxi trips', 'design schema · 4 tables', 'draft · gpt-oss-120b', 'verify on Postgres ×4', 'blind-solve · qwen3', 'editor review · 8.5/10'].map((s, i) => (
          <motion.div key={s} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 * i }} className="flex items-center gap-2.5">
            <span className="grid size-4 place-items-center rounded-full bg-accent-strong/90">
              <Check className="size-2.5 text-white" />
            </span>
            <span className="text-ink/85">{s}</span>
          </motion.div>
        ))}
      </div>
    ),
  },
];

function Showcase() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI((x) => (x + 1) % SHOWCASE.length), 5200);
    return () => clearInterval(t);
  }, [paused]);
  const s = SHOWCASE[i];
  return (
    <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <Link to="/" aria-label="Querion home" className="w-fit">
        <Logo size={30} />
      </Link>
      <div className="max-w-md">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }} transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="eyebrow mb-4">{s.kicker}</div>
            <h2 className="display text-[34px] xl:text-[40px]">{s.title}</h2>
            <div className="glass-strong mt-8 rounded-xl p-5 [transform:perspective(1200px)_rotateX(4deg)_rotateY(-6deg)]">{s.body}</div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex items-center gap-2">
        {SHOWCASE.map((_, k) => (
          <button key={k} onClick={() => setI(k)} aria-label={`Show slide ${k + 1}`} className={cx('h-1 rounded-full transition-all duration-500', k === i ? 'w-8 bg-accent' : 'w-3 bg-line-strong hover:bg-faint')} />
        ))}
        <span className="ml-auto text-xs text-faint">PostgreSQL 17 · free forever</span>
      </div>
    </div>
  );
}

// ───────── page ─────────
export function AuthPage() {
  const { pathname } = useLocation();
  const mode = modeFromPath(pathname);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const clientId = useApp((s) => s.clientId);
  const next = safeNext(params.get('next'));
  const keep = params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : '';

  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [formRef, animateForm] = useAnimate();
  const shake = () => {
    if (formRef.current) void animateForm(formRef.current, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.35 });
  };
  const [sent, setSent] = useState(false);
  const ref = params.get('ref') ?? (() => { try { return localStorage.getItem('querion-ref'); } catch { return null; } })() ?? undefined;

  useEffect(() => {
    setTouched(false);
    setSent(false);
    m.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const s = useMemo(() => strength(password), [password]);
  const errors = {
    handle: mode === 'signup' && !/^[a-zA-Z0-9_]{3,24}$/.test(handle) ? '3–24 letters, digits or _' : null,
    email: (mode === 'login' || mode === 'signup' || mode === 'forgot') && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) ? 'Enter a valid email address' : null,
    password: mode === 'login' ? (!password ? 'Enter your password' : null) : mode === 'signup' || mode === 'reset' ? (s.checks[0].ok && s.checks[1].ok ? null : 'Use 8+ characters with a number or symbol') : null,
    confirm: mode === 'reset' && confirm !== password ? "Passwords don't match" : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);

  const m = useMutation({
    mutationFn: async () => {
      if (mode === 'login') return api<{ user: SessionUser }>('/auth/login', { method: 'POST', json: { email, password } });
      if (mode === 'signup') return api<{ user: SessionUser }>('/auth/register', { method: 'POST', json: { handle, email, password, ref }, headers: { 'X-Client-Id': clientId } });
      if (mode === 'forgot') return api<{ ok: true }>('/auth/forgot', { method: 'POST', json: { email } });
      return api<{ ok: true }>('/auth/reset', { method: 'POST', json: { token: params.get('token') ?? '', password } });
    },
    onSuccess: async (r) => {
      if (mode === 'forgot') return setSent(true);
      await qc.invalidateQueries({ queryKey: SESSION_KEY });
      if ('user' in r && r.user) qc.setQueryData(SESSION_KEY, { user: r.user });
      nav(mode === 'signup' ? '/dashboard?welcome=1' : next, { replace: true });
    },
    onError: () => shake(),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return shake();
    m.mutate();
  };

  const serverError = m.error instanceof ApiError ? m.error.message : m.error ? 'Something went wrong — try again.' : null;
  const corners = mode === 'signup' ? 'tr-bl' : 'tl-br';
  const copy = COPY[mode];

  return (
    <div className="relative grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <Seo title={`${copy.seo} | Querion`} description="Sign in to Querion — SQL practice on real data with fresh, verified problems every week." path={pathname} noindex />

      {/* left: showcase (desktop) */}
      <aside className="relative hidden overflow-hidden border-r border-line lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(47,91,255,0.22),transparent_60%),radial-gradient(90%_70%_at_100%_100%,rgba(47,91,255,0.14),transparent_60%)]" />
        <PixelField corners={corners} />
        <Showcase />
      </aside>

      {/* right: form */}
      <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10">
        <div className="lg:hidden">
          <PixelField corners={corners} />
        </div>
        <div className="relative z-10 w-full max-w-[380px]">
          <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted transition-colors hover:text-ink lg:hidden">
            <LogoMark size={26} />
          </Link>
          <AnimatePresence mode="wait">
            <motion.div key={mode} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}>
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{copy.title}</h1>
              <p className="mt-2 text-[15px] text-muted">{copy.sub}</p>

              {mode === 'forgot' && sent ? (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="mt-8 rounded-xl border border-ok/30 bg-ok/[0.06] p-5">
                  <MailCheck className="size-5 text-ok" />
                  <div className="mt-3 font-medium">Check your inbox</div>
                  <p className="mt-1 text-sm text-muted">If an account exists for <b className="text-ink">{email}</b>, a reset link is on its way. It expires in 30 minutes.</p>
                  <Link to="/login" className="mt-4 inline-flex items-center gap-1 text-sm text-accent hover:underline">
                    <ArrowLeft className="size-3.5" /> Back to sign in
                  </Link>
                </motion.div>
              ) : mode === 'reset' && !params.get('token') ? (
                <div className="mt-8 rounded-xl border border-bad/30 bg-bad/[0.06] p-5 text-sm text-muted">
                  This reset link is incomplete. <Link to="/forgot-password" className="text-accent hover:underline">Request a new one</Link>.
                </div>
              ) : (
                <form ref={formRef} onSubmit={submit} noValidate className="mt-8 space-y-4">
                  {mode === 'signup' && (
                    <Stagger i={0}>
                      <Field name="handle" label="Handle" value={handle} onChange={setHandle} autoComplete="username" autoFocus error={show('handle')} hint={<span className="text-xs font-normal text-faint">Shown on leaderboards</span>} />
                    </Stagger>
                  )}
                  {mode !== 'reset' && (
                    <Stagger i={1}>
                      <Field name="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus={mode !== 'signup'} error={show('email')} />
                    </Stagger>
                  )}
                  {mode !== 'forgot' && (
                    <Stagger i={2}>
                      <PasswordInput
                        name="password"
                        label={mode === 'reset' ? 'New password' : 'Password'}
                        value={password}
                        onChange={setPassword}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        autoFocus={mode === 'reset'}
                        error={show('password')}
                        hint={
                          mode === 'login' ? (
                            <Link to="/forgot-password" tabIndex={-1} className="text-xs font-normal text-accent hover:underline">
                              Forgot password?
                            </Link>
                          ) : undefined
                        }
                      />
                      {(mode === 'signup' || mode === 'reset') && password && (
                        <div className="mt-2.5">
                          <div className="flex gap-1">
                            {[0, 1, 2, 3].map((k) => (
                              <span key={k} className={cx('h-1 flex-1 rounded-full transition-colors duration-300', k < s.score ? (s.score <= 1 ? 'bg-bad' : s.score === 2 ? 'bg-warn' : 'bg-ok') : 'bg-line-strong')} />
                            ))}
                          </div>
                          <ul className="mt-2 space-y-0.5">
                            {s.checks.map((c) => (
                              <li key={c.label} className={cx('flex items-center gap-1.5 text-xs transition-colors', c.ok ? 'text-ok' : 'text-faint')}>
                                <Check className="size-3" /> {c.label}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </Stagger>
                  )}
                  {mode === 'reset' && (
                    <Stagger i={3}>
                      <PasswordInput name="confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={show('confirm')} />
                    </Stagger>
                  )}

                  <AnimatePresence>
                    {serverError && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/[0.07] px-3 py-2.5 text-sm text-bad">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" /> {serverError}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Stagger i={4}>
                    <Button type="submit" variant="primary" size="lg" className="w-full !rounded-lg" loading={m.isPending} icon={!m.isPending ? <ArrowRight className="size-4" /> : undefined}>
                      {mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Update password'}
                    </Button>
                  </Stagger>

                  <Stagger i={5}>
                    <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-faint">
                      <Lock className="size-3" /> Encrypted connection · httpOnly session · passwords hashed with bcrypt
                    </div>
                  </Stagger>
                </form>
              )}

              <div className="mt-8 border-t border-line pt-6 text-center text-sm text-muted">
                {mode === 'login' && (
                  <>New to Querion? <Link to={`/signup${keep}`} className="font-medium text-accent hover:underline">Create an account</Link></>
                )}
                {mode === 'signup' && (
                  <>Already have an account? <Link to={`/login${keep}`} className="font-medium text-accent hover:underline">Sign in</Link></>
                )}
                {(mode === 'forgot' || mode === 'reset') && (
                  <Link to="/login" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    <ArrowLeft className="size-3.5" /> Back to sign in
                  </Link>
                )}
              </div>
              {mode === 'signup' && ref && <p className="mt-4 text-center text-xs text-accent">Invited by @{ref}</p>}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function Stagger({ i, children }: { i: number; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.06, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

import { motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, Bot, Database, Flame, Gauge, Layers, Mail, ShieldCheck, Sparkles, Timer, Zap } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LogoMark } from '../components/Logo';
import { Seo } from '../components/Seo';
import { Button, cx, DifficultyPill, Kbd, Skeleton, StatusDot, TierBadge } from '../components/ui';
import { modKey } from '../lib/hooks';
import { AUTHOR, authorJsonLd, SITE } from '../lib/site';
import { GithubIcon, LinkedinIcon } from '../components/BrandIcons';
import { useMeta, useNext, useToday } from '../lib/queries';
import { useSession } from '../lib/session';

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="font-mono tabular-nums">
      {p(Math.floor(ms / 3600000))}:{p(Math.floor((ms % 3600000) / 60000))}:{p(Math.floor((ms % 60000) / 1000))}
    </span>
  );
}

/** Swiss-style section header: index number, label, hairline. */
function Section({ n, label, title, children, aside }: { n: string; label: string; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-8 grid gap-4 md:grid-cols-12 md:items-end">
      <div className="md:col-span-8">
        <div className="eyebrow mb-3 flex items-center gap-3">
          <span className="text-accent">{n}</span>
          <span className="h-px w-8 bg-line-strong" />
          {label}
        </div>
        <h2 className="display text-[30px] md:text-[40px]">{title}</h2>
        {children && <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{children}</p>}
      </div>
      {aside && <div className="md:col-span-4 md:justify-self-end">{aside}</div>}
    </div>
  );
}

const fade = { initial: { opacity: 0, y: 14 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] as const } };

export function Landing() {
  const { data: meta } = useMeta();
  const { data: today, isLoading } = useToday();
  const { user } = useSession();
  const { data: next } = useNext(!!user);
  const stats = meta
    ? [
        { v: meta.counts.problems, l: 'verified problems' },
        { v: meta.counts.datasets, l: 'real datasets' },
        { v: `${Math.round(meta.counts.rows / 1000)}k`, l: 'rows of data' },
        { v: meta.counts.forged, l: 'forged by Nebula' },
      ]
    : null;

  return (
    <div className="relative">
      <Seo
        title="Querion — Master SQL on real data, judged like an interview | by Rahul Choudhary"
        description="Querion by Rahul Choudhary: a free PostgreSQL practice studio with fresh SQL interview problems forged weekly from real Kaggle datasets, verified on real Postgres, judged on hidden test data, with an AI tutor that never spoils the answer."
        path="/"
        jsonLd={LANDING_LD}
      />

      {/* ───────── Hero (Swiss grid, aurora behind) ───────── */}
      <div className="grid-bg pointer-events-none absolute inset-x-0 top-0 h-[720px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" aria-hidden />
      <section className="relative mx-auto max-w-6xl px-4 pb-12 pt-14 md:px-8 md:pt-24">
        <div className="grid gap-10 md:grid-cols-12">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }} className="md:col-span-8">
            <div className="eyebrow mb-6 flex items-center gap-3">
              <span className="size-1.5 animate-pulse rounded-full bg-ok" />
              PostgreSQL 17 · in your browser · free forever
            </div>
            <h1 className="display text-[46px] sm:text-[64px] md:text-[84px]">
              Master SQL
              <br />
              on <span className="text-nebula">real data</span>.
            </h1>
            <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-muted">
              Fresh problems forged every week from real Kaggle datasets. Each one verified on real Postgres, judged on hidden data, and coached by an AI that never hands you the answer.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              {user ? (
                <>
                  <Link to="/dashboard">
                    <Button size="lg" variant="primary" icon={<ArrowRight className="size-4" />}>
                      Open your dashboard
                    </Button>
                  </Link>
                  <Link to={today?.daily ? `/p/${today.daily.slug}` : '/problems'}>
                    <Button size="lg" className="glass" icon={<Flame className="size-4" />}>Today's Orbit</Button>
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/signup">
                    <Button size="lg" variant="primary" icon={<ArrowRight className="size-4" />}>
                      Start practising — free
                    </Button>
                  </Link>
                  <Link to="/login">
                    <Button size="lg" className="glass">Log in</Button>
                  </Link>
                </>
              )}
              <span className="ml-1 hidden items-center gap-1.5 text-xs text-faint md:flex">
                or press <Kbd>{modKey}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </div>
          </motion.div>

          {/* daily card */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }} className="md:col-span-4 md:self-end">
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <span className="eyebrow flex items-center gap-2 !text-warn">
                  <Flame className="size-3.5" /> Daily Orbit
                </span>
                {today && (
                  <span className="flex items-center gap-1.5 text-[11px] text-muted">
                    <Timer className="size-3" /> <Countdown to={today.nextReleaseAt} />
                  </span>
                )}
              </div>
              {isLoading ? (
                <div className="mt-4 space-y-2">
                  <Skeleton className="h-6 w-4/5" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : today?.daily ? (
                <Link to={`/p/${today.daily.slug}`} className="group mt-3 block">
                  <div className="text-lg font-semibold leading-snug tracking-[-0.02em] group-hover:text-accent">{today.daily.title}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <DifficultyPill d={today.daily.difficulty} />
                    <TierBadge tier={today.daily.tier} />
                    <span className="truncate">{today.daily.datasetName}</span>
                    <StatusDot status={today.daily.status} />
                  </div>
                </Link>
              ) : (
                <p className="mt-3 text-sm text-muted">Today's problem is being forged — check back shortly.</p>
              )}
            </div>
          </motion.div>
        </div>

        {/* product window — the real studio, not an illustration */}
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.25, ease: [0.2, 0.8, 0.2, 1] }} className="mt-14">
          <ProductWindow />
        </motion.div>

        {/* stat strip */}
        <div className="mt-14 grid grid-cols-2 border-y border-line md:grid-cols-4">
          {(stats ?? Array.from({ length: 4 }, () => null)).map((s, i) => (
            <div key={i} className={cx('px-1 py-5 md:px-5', i > 0 && 'md:border-l md:border-line', i % 2 === 1 && 'max-md:border-l max-md:border-line max-md:pl-5')}>
              {s ? (
                <>
                  <div className="display text-[32px] tabular-nums">{s.v}</div>
                  <div className="eyebrow mt-1">{s.l}</div>
                </>
              ) : (
                <Skeleton className="h-12 w-24" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ───────── 01 · This week ───────── */}
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8">
        <Section n="01" label="This week" title={<>Fresh problems, <span className="text-nebula">picked for you</span>.</>}>
          A new Constellation pack lands every Monday — forged from newly scouted Kaggle data and tuned to what learners struggled with last week.
        </Section>
        <div className="grid gap-4 md:grid-cols-12">
          <motion.div {...fade} className="glass rounded-2xl p-6 md:col-span-7">
            <div className="eyebrow mb-4 flex items-center gap-2">
              <Sparkles className="size-3.5 text-accent" /> Weekly constellation
            </div>
            <div className="grid gap-1">
              {!today ? (
                [1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)
              ) : today.weekly.length ? (
                today.weekly.map((w, i) => (
                  <Link key={w.slug} to={`/p/${w.slug}`} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-panel-2/70">
                    <span className="w-6 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                    <StatusDot status={w.status} />
                    <span className="flex-1 truncate text-sm font-medium group-hover:text-accent">{w.title}</span>
                    <TierBadge tier={w.tier} />
                    <DifficultyPill d={w.difficulty} />
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted">This week's pack is being forged.</p>
              )}
            </div>
          </motion.div>
          <motion.div {...fade} transition={{ ...fade.transition, delay: 0.08 }} className="glass rounded-2xl p-6 md:col-span-5">
            <div className="eyebrow mb-4 flex items-center gap-2">
              <Zap className="size-3.5 text-accent" /> {user ? 'Up next for you' : 'Your personal plan'}
            </div>
            {!user ? (
              <div className="flex h-[calc(100%-2rem)] flex-col justify-between gap-6">
                <p className="text-sm leading-relaxed text-muted">
                  Tell us your level and the worlds you care about. Querion builds a ladder for you, tracks your weak topics, and keeps your streak going across devices.
                </p>
                <div className="grid gap-2">
                  {['Personal next-problem picks', 'Streaks, heatmap & topic mastery', 'AI code reviews after you solve'].map((t) => (
                    <div key={t} className="flex items-center gap-2 text-sm text-ink/85">
                      <span className="size-1.5 rounded-full bg-accent" /> {t}
                    </div>
                  ))}
                </div>
                <Link to="/signup">
                  <Button className="w-full" icon={<ArrowRight className="size-4" />}>Create your free account</Button>
                </Link>
              </div>
            ) : (
            <div className="grid gap-2">
              {!next
                ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)
                : next.map((r) => (
                    <Link key={r.slug} to={`/p/${r.slug}`} className="group rounded-xl border border-line bg-panel/40 p-3 transition-all hover:border-accent/40">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium group-hover:text-accent">{r.title}</span>
                        <ArrowUpRight className="ml-auto size-4 shrink-0 text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
                      </div>
                      <div className="mt-1 text-xs text-muted">{r.reason}</div>
                    </Link>
                  ))}
            </div>
            )}
          </motion.div>
        </div>
      </section>

      {/* ───────── 02 · Tracks ───────── */}
      <section id="tracks" className="cv-auto mx-auto max-w-6xl scroll-mt-20 px-4 py-12 md:px-8">
        <Section n="02" label="Tracks" title={<>Pick a world. Climb six tiers.</>}>
          Every dataset is a ladder: Foundations → Aggregation → Relationships → Composition → Analytics → Architect.
        </Section>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {(meta?.domains ?? []).filter((d) => d.datasets.length).map((d, i) => (
            <motion.div key={d.key} {...fade} transition={{ ...fade.transition, delay: i * 0.04 }}>
              <Link to={`/tracks/${d.datasets[0]}`} className="group flex h-full flex-col bg-[#0b0d12] p-6 transition-colors hover:bg-panel">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                  <span className="size-2 rounded-full" style={{ background: `oklch(0.75 0.15 ${d.hue})`, boxShadow: `0 0 12px oklch(0.75 0.15 ${d.hue})` }} />
                </div>
                <div className="mt-8 text-xl font-semibold tracking-[-0.02em]">{d.label}</div>
                <div className="mt-1 text-sm text-muted">{d.blurb}</div>
                <div className="mt-6 flex items-center gap-2 text-xs text-faint">
                  <span>{d.problems} problems</span>
                  <ArrowRight className="ml-auto size-4 text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ───────── 03 · Why it's different (bento) ───────── */}
      <section id="why" className="cv-auto mx-auto max-w-6xl scroll-mt-20 px-4 py-12 md:px-8">
        <Section n="03" label="Why Querion" title={<>Built to close the gaps other SQL sites leave open.</>} />
        <div className="grid auto-rows-[minmax(170px,auto)] gap-4 md:grid-cols-6">
          <Bento className="md:col-span-4 md:row-span-2" icon={<Sparkles className="size-5" />} title="Problems nobody has memorised" kicker="Nebula agent">
            Every Sunday an AI agent scouts Kaggle, designs a relational schema, and forges a ladder of new problems. Nothing a model claims is trusted: references must pass on 4 hidden data variants, be deterministic, and be re-solved by a second model from the statement alone before an editor model approves them.
            <div className="mt-5 grid grid-cols-3 gap-2 font-mono text-[11px]">
              {['scout', 'design schema', 'draft', 'verify ×4', 'blind-solve', 'critic'].map((s, i) => (
                <div key={s} className="rounded-lg border border-line bg-panel/50 px-2.5 py-2 text-muted">
                  <span className="text-accent">{String(i + 1).padStart(2, '0')}</span> {s}
                </div>
              ))}
            </div>
          </Bento>
          <Bento className="md:col-span-2" icon={<Database className="size-5" />} title="Real Postgres, in your browser" kicker="Instant">
            PostgreSQL compiled to WebAssembly. Runs are instant, private and work offline.
          </Bento>
          <Bento className="md:col-span-2" icon={<ShieldCheck className="size-5" />} title="Hidden test datasets" kicker="Like DSA judges">
            Shuffled, sparse and tie-heavy data you never see.
          </Bento>
          <Bento className="md:col-span-3" icon={<Gauge className="size-5" />} title="Optimal, not just correct" kicker="Architect tier">
            Accepted answers are compared to the reference plan cost. Architect problems fail if you blow the budget.
          </Bento>
          <Bento className="md:col-span-3" icon={<Bot className="size-5" />} title="A tutor that never spoils" kicker="AI · Groq">
            A three-step hint ladder personalised to your query, plain-English error fixes, and a senior-style code review after you solve.
          </Bento>
          <Bento className="md:col-span-6" icon={<Layers className="size-5" />} title="From first SELECT to system design" kicker="Six tiers per dataset">
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
              {(meta?.tiers ?? []).map((t) => (
                <div key={t.tier} className={cx('rounded-xl border p-3', t.tier === 6 ? 'border-accent/40 bg-accent-soft' : 'border-line bg-panel/40')}>
                  <div className="font-mono text-[11px] text-faint">T{t.tier}</div>
                  <div className="mt-1 text-sm font-medium">{t.name}</div>
                </div>
              ))}
            </div>
          </Bento>
        </div>
      </section>

      {/* ───────── 04 · Maker ───────── */}
      <section id="maker" className="cv-auto mx-auto max-w-6xl scroll-mt-20 px-4 py-12 md:px-8">
        <Section n="04" label="Built by" title={<>Designed &amp; engineered by <span className="text-nebula">{AUTHOR.name}</span>.</>} />
        <motion.div {...fade} className="glass grid gap-8 rounded-2xl p-6 md:grid-cols-12 md:p-8">
          <div className="md:col-span-5">
            <div className="flex items-center gap-4">
              <div className="grid size-14 place-items-center rounded-2xl bg-accent-strong text-lg font-semibold text-white">RC</div>
              <div>
                <div className="text-lg font-semibold">{AUTHOR.name}</div>
                <div className="text-sm text-muted">
                  {AUTHOR.role} · {AUTHOR.location}
                </div>
              </div>
            </div>
            <p className="mt-5 text-[15px] leading-relaxed text-muted">{AUTHOR.bio}</p>
            <p className="mt-3 text-sm text-faint">{AUTHOR.education}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href={AUTHOR.linkedin} target="_blank" rel="noopener noreferrer me author">
                <Button icon={<LinkedinIcon className="size-4" />}>LinkedIn</Button>
              </a>
              <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer me">
                <Button icon={<GithubIcon className="size-4" />}>GitHub</Button>
              </a>
              <a href={`mailto:${AUTHOR.email}`}>
                <Button variant="ghost" icon={<Mail className="size-4" />}>Email</Button>
              </a>
            </div>
          </div>
          <div className="grid gap-4 md:col-span-7 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-panel/40 p-5">
              <div className="eyebrow mb-3">Stack behind Querion</div>
              <div className="flex flex-wrap gap-1.5">
                {['TypeScript', 'React 19', 'Hono', 'PostgreSQL 17', 'PGlite / WASM', 'Groq LLMs', 'Kaggle API', 'Cloudflare'].map((t) => (
                  <span key={t} className="rounded-md border border-line px-2 py-1 font-mono text-[11px] text-muted">{t}</span>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-panel/40 p-5">
              <div className="eyebrow mb-3">Also by Rahul</div>
              {AUTHOR.projects.map((p) => (
                <div key={p.name}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1 font-medium hover:text-accent">
                    {p.name} <ArrowUpRight className="size-3.5" />
                  </a>
                  <p className="mt-1 text-sm text-muted">{p.blurb}</p>
                  <a href={p.code} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-faint hover:text-ink">
                    <GithubIcon className="size-3" /> Source
                  </a>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-line bg-panel/40 p-5 sm:col-span-2">
              <div className="eyebrow mb-3">Engineering highlights</div>
              <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
                <li>· Hidden-test judge on real Postgres, sandboxed in worker threads</li>
                <li>· Weekly AI agent: Kaggle → schema → verified problems</li>
                <li>· Cross-model blind solving + editor rubric for quality</li>
                <li>· httpOnly sessions, CSRF defence, strict CSP, lockout</li>
              </ul>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ───────── 05 · FAQ ───────── */}
      <section id="faq" className="cv-auto mx-auto max-w-6xl scroll-mt-20 px-4 py-12 md:px-8">
        <Section n="05" label="FAQ" title="Questions, answered." />
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-[#0b0d12]/90">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4 md:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                {f.q}
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line text-faint transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
        {!user && (
          <div className="glass mt-10 flex flex-col items-start justify-between gap-5 rounded-2xl p-6 md:flex-row md:items-center md:p-8">
            <div>
              <h3 className="text-xl font-semibold tracking-[-0.02em]">Your first query is 30 seconds away.</h3>
              <p className="mt-1 text-sm text-muted">Free forever. No card. Real PostgreSQL in your browser.</p>
            </div>
            <Link to="/signup">
              <Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />}>Create free account</Button>
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

const FAQ = [
  { q: 'Is Querion really free?', a: 'Yes. Querion runs on free tiers end to end (PostgreSQL in your browser, Groq for AI, Kaggle for data), so there is no paid plan and no card required.' },
  { q: 'Which SQL dialect does it use?', a: 'PostgreSQL 17. Your queries run on real Postgres compiled to WebAssembly in your browser, and submissions are judged on real Postgres on the server — window functions, CTEs, FILTER, DISTINCT ON and all.' },
  { q: 'Where do the problems come from?', a: 'A curated core bank plus fresh problems every week: an AI agent scouts new open-licence datasets on Kaggle, designs a relational schema, and drafts problems from Easy to Architect. Every problem is verified on Postgres, blind-solved by a second model and reviewed before it is published.' },
  { q: 'How is a submission judged?', a: 'Against four datasets: the sample you can see plus three hidden variants (shuffled storage order, sparse data, ties & duplicates). Architect-tier problems also check that your query plan stays within a cost budget.' },
  { q: 'Will the AI tutor just give me the answer?', a: 'No. Hints come in three steps — nudge, concept, skeleton with blanks — and every AI reply passes a leak guard. Full solutions and a code review unlock after you solve.' },
  { q: 'How is my account secured?', a: 'Passwords are hashed with bcrypt, sessions are httpOnly cookies that JavaScript cannot read, every state-changing request is CSRF-protected, repeated failed logins lock the account, and you can sign out any device from Settings.' },
  { q: 'Who built Querion?', a: `${AUTHOR.name}, a ${AUTHOR.role.toLowerCase()} from ${AUTHOR.location}. Find him on LinkedIn and GitHub (links above and in the footer).` },
];

const K = ({ children }: { children: ReactNode }) => <span className="font-semibold text-accent">{children}</span>;
const F = ({ children }: { children: ReactNode }) => <span className="text-accent-2">{children}</span>;
const N = ({ children }: { children: ReactNode }) => <span className="text-warn">{children}</span>;

/** A faithful, static rendering of the studio: query → result → judged. */
function ProductWindow() {
  const rows: [string, string, string, string][] = [
    ['R7', 'IT Corridor Express', '41.2', '1'],
    ['R1', 'Central – Hinjewadi Express', '38.9', '2'],
    ['R4', 'Kothrud – Kharadi Crosstown', '33.5', '3'],
    ['R11', 'Wagholi – Swargate Line', '31.8', '4'],
  ];
  return (
    <div className="glass-strong overflow-hidden rounded-2xl">
      {/* window chrome */}
      <div className="flex h-10 items-center gap-2 border-b border-line px-4">
        <span className="size-2.5 rounded-full bg-[#ff5f57]/80" />
        <span className="size-2.5 rounded-full bg-[#febc2e]/80" />
        <span className="size-2.5 rounded-full bg-[#28c840]/80" />
        <span className="ml-3 truncate font-mono text-[11px] text-faint">querion.app/p/route-load-factor-board</span>
        <span className="ml-auto hidden items-center gap-1.5 font-mono text-[11px] text-ok sm:flex">
          <span className="size-1.5 rounded-full bg-ok" /> postgres 17 · wasm
        </span>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* editor */}
        <div className="min-w-0 overflow-x-auto border-line p-4 font-mono text-[11.5px] leading-[1.75] max-lg:border-b lg:border-r lg:p-5 xl:text-[12.5px]">
          {[
            <><K>SELECT</K> r.route_code,</>,
            <>       <F>ROUND</F>(<N>100.0</N> * <F>AVG</F>(t.passengers::<K>numeric</K> / b.capacity), <N>1</N>) <K>AS</K> load_pct,</>,
            <>       <F>RANK</F>() <K>OVER</K> (<K>ORDER BY</K> <F>AVG</F>(t.passengers::<K>numeric</K> / b.capacity) <K>DESC</K>) <K>AS</K> rnk</>,
            <><K>FROM</K> trips t</>,
            <><K>JOIN</K> routes r <K>ON</K> r.route_id = t.route_id</>,
            <><K>JOIN</K> buses  b <K>ON</K> b.bus_id   = t.bus_id</>,
            <><K>WHERE</K> t.status = <span className="text-ok">'completed'</span></>,
            <><K>GROUP BY</K> r.route_code</>,
            <><K>ORDER BY</K> rnk, r.route_code;</>,
          ].map((line, i) => (
            <div key={i} className="flex whitespace-pre">
              <span className="w-7 shrink-0 select-none text-right text-faint/60">{i + 1}</span>
              <span className="pl-4 text-ink/90">{line}</span>
            </div>
          ))}
        </div>
        {/* result + verdict */}
        <div className="flex flex-col">
          <div className="flex items-center gap-4 border-b border-line px-4 font-mono text-[11px] text-faint">
            <span className="border-b border-accent py-2.5 text-ink">Result</span>
            <span className="py-2.5">Tests</span>
            <span className="py-2.5">Query plan</span>
            <span className="ml-auto">12 rows · 3.1 ms</span>
          </div>
          <table className="w-full font-mono text-[11.5px]">
            <thead>
              <tr className="text-left text-faint">
                <th className="px-4 py-2 font-normal">route_code</th>
                <th className="hidden px-2 py-2 font-normal lg:table-cell">name</th>
                <th className="px-2 py-2 text-right font-normal">load_pct</th>
                <th className="px-4 py-2 text-right font-normal">rnk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]} className="border-t border-line/60">
                  <td className="px-4 py-1.5">{r[0]}</td>
                  <td className="hidden truncate px-2 py-1.5 text-muted lg:table-cell">{r[1]}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r[2]}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line p-3 font-mono text-[11px] sm:grid-cols-4">
            {['Sample data', 'Shuffled order', 'Sparse data', 'Ties & dupes'].map((t, i) => (
              <div key={t} className="flex items-center gap-1.5 rounded-lg border border-ok/25 bg-ok/[0.06] px-2 py-1.5 text-ok">
                <span>✓</span>
                <span className="truncate text-ink/80">{t}</span>
                {i > 0 && <span className="ml-auto text-faint">hidden</span>}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 font-mono text-[11px]">
            <span className="text-ok">Accepted · 4/4</span>
            <span className="text-faint">
              plan cost <span className="text-ink">212.4</span> / budget 340.0
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bento({ className, icon, title, kicker, children }: { className?: string; icon: ReactNode; title: string; kicker: string; children: ReactNode }) {
  return (
    <motion.div {...fade} className={cx('glass group relative overflow-hidden rounded-2xl p-6', className)}>
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</span>
        <span className="eyebrow">{kicker}</span>
      </div>
      <div className="mt-5 text-lg font-semibold tracking-[-0.02em]">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
    </motion.div>
  );
}

/** Structured data: the app, its creator (with LinkedIn/GitHub via sameAs) and the FAQ — eligible for rich results. */
const LANDING_LD = {
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'Querion',
      url: typeof location !== 'undefined' ? location.origin + '/' : '/',
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Any (web browser)',
      description: SITE.tagline + ' Fresh SQL problems from real Kaggle datasets, verified on PostgreSQL 17.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: authorJsonLd,
      creator: authorJsonLd,
      codeRepository: SITE.repo,
    },
    authorJsonLd,
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ],
};

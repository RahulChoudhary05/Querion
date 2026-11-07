import { motion } from 'motion/react';
import { ArrowRight, ArrowUpRight, Flame, PartyPopper, Sparkles, Target, Timer, Trophy, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Seo } from '../components/Seo';
import { Button, cx, DifficultyPill, Skeleton, StatusDot, TierBadge } from '../components/ui';
import { useMeta, useNext, useProblems, useStats, useToday } from '../lib/queries';
import { useSession } from '../lib/session';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const p = (n: number) => String(n).padStart(2, '0');
  return <span className="font-mono tabular-nums">{p(Math.floor(ms / 3600000))}:{p(Math.floor((ms % 3600000) / 60000))}:{p(Math.floor((ms % 60000) / 1000))}</span>;
}

const card = 'glass rounded-2xl p-5 md:p-6';
const fade = (i: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.05 * i, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const } });

export function Dashboard() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const welcome = params.get('welcome') === '1';
  const { data: stats } = useStats();
  const { data: today } = useToday();
  const { data: next } = useNext();
  const { data: problems } = useProblems();
  const { data: meta } = useMeta();

  const solvedTotal = stats ? Object.values(stats.solved).reduce((a, b) => a + b, 0) : 0;
  const allTotal = stats ? Object.values(stats.totals).reduce((a, b) => a + b, 0) : 0;
  const tracks = useMemo(() => {
    if (!problems || !meta) return [];
    return meta.datasets
      .map((d) => {
        const ps = problems.filter((p) => p.dataset_key === d.key);
        return { ...d, total: ps.length, solved: ps.filter((p) => p.status === 'solved').length, attempted: ps.some((p) => p.status) };
      })
      .filter((t) => t.total > 0)
      .sort((a, b) => Number(b.attempted) - Number(a.attempted) || b.solved / b.total - a.solved / a.total);
  }, [problems, meta]);
  const lead = next?.[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-10">
      <Seo title="Dashboard | Querion" description="Your SQL practice dashboard." path="/dashboard" noindex />

      {welcome && (
        <motion.div {...fade(0)} className="mb-6 flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4">
          <PartyPopper className="mt-0.5 size-5 text-accent" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Welcome to Querion, {user?.handle}.</div>
            <div className="text-muted">Your account is ready. Start with the pick below — we'll adapt as you solve.</div>
          </div>
          <button onClick={() => setParams({}, { replace: true })} className="text-faint hover:text-ink" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </motion.div>
      )}

      {/* header */}
      <motion.div {...fade(0)} className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1 className="display text-[32px] md:text-[42px]">
            {greeting()}, <span className="text-nebula">{user?.handle}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm">
            <Flame className={cx('size-4', stats?.streak ? 'text-warn' : 'text-faint')} />
            <b>{stats?.streak ?? 0}</b>
            <span className="text-muted">day streak</span>
          </div>
          <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm">
            <Trophy className="size-4 text-accent" />
            <b>{solvedTotal}</b>
            <span className="text-muted">/ {allTotal || '–'} solved</span>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* continue */}
        <motion.div {...fade(1)} className={cx(card, 'relative overflow-hidden lg:col-span-7')}>
          <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-accent-strong/20 blur-3xl" />
          <div className="eyebrow mb-4 flex items-center gap-2">
            <Target className="size-3.5 text-accent" /> {lead?.kind === 'start' ? 'Start here' : 'Continue'}
          </div>
          {!next ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-11 w-40" />
            </div>
          ) : lead ? (
            <>
              <h2 className="text-2xl font-semibold tracking-[-0.02em] md:text-[28px]">{lead.title}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                <DifficultyPill d={lead.difficulty} />
                <TierBadge tier={lead.tier} showName />
                <span>{lead.datasetName}</span>
              </div>
              <p className="mt-3 text-sm text-muted">{lead.reason}</p>
              <Link to={`/p/${lead.slug}`} className="mt-6 inline-block">
                <Button variant="primary" size="lg" icon={<ArrowRight className="size-4" />}>
                  {lead.kind === 'start' ? 'Start solving' : 'Continue'}
                </Button>
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted">You've solved everything available — new problems arrive Monday.</p>
          )}
        </motion.div>

        {/* daily orbit */}
        <motion.div {...fade(2)} className={cx(card, 'lg:col-span-5')}>
          <div className="flex items-center justify-between">
            <span className="eyebrow flex items-center gap-2 !text-warn">
              <Flame className="size-3.5" /> Daily Orbit
            </span>
            {today && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <Timer className="size-3" /> next in <Countdown to={today.nextReleaseAt} />
              </span>
            )}
          </div>
          {!today ? (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : today.daily ? (
            <Link to={`/p/${today.daily.slug}`} className="group mt-4 block">
              <div className="text-lg font-semibold leading-snug group-hover:text-accent">{today.daily.title}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <DifficultyPill d={today.daily.difficulty} />
                <TierBadge tier={today.daily.tier} />
                <span>{today.daily.datasetName}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <StatusDot status={today.daily.status} />
                  {today.daily.status === 'solved' ? 'Done today' : 'Not solved yet'}
                </span>
              </div>
            </Link>
          ) : (
            <p className="mt-4 text-sm text-muted">Today's problem is being forged.</p>
          )}
          <div className="hairline my-5" />
          <div className="grid grid-cols-3 gap-2 text-center">
            {(['Easy', 'Medium', 'Hard'] as const).map((d) => (
              <div key={d} className="rounded-xl bg-panel-2/60 py-3">
                <div className={cx('text-xl font-semibold tabular-nums', d === 'Easy' ? 'text-easy' : d === 'Medium' ? 'text-medium' : 'text-hard')}>
                  {stats?.solved[d] ?? 0}
                </div>
                <div className="text-[11px] text-faint">
                  {d} / {stats?.totals[d] ?? '–'}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* weekly pack */}
        <motion.div {...fade(3)} className={cx(card, 'lg:col-span-7')}>
          <div className="eyebrow mb-4 flex items-center gap-2">
            <Sparkles className="size-3.5 text-accent" /> This week's constellation
          </div>
          <div className="grid gap-0.5">
            {!today ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)
            ) : today.weekly.length ? (
              today.weekly.map((w, i) => (
                <Link key={w.slug} to={`/p/${w.slug}`} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-panel-2/70">
                  <span className="w-6 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                  <StatusDot status={w.status} />
                  <span className="flex-1 truncate text-sm font-medium group-hover:text-accent">{w.title}</span>
                  <TierBadge tier={w.tier} />
                  <DifficultyPill d={w.difficulty} className="max-sm:hidden" />
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted">This week's pack is being forged.</p>
            )}
          </div>
        </motion.div>

        {/* up next */}
        <motion.div {...fade(4)} className={cx(card, 'lg:col-span-5')}>
          <div className="eyebrow mb-4">Picked for you</div>
          <div className="grid gap-2">
            {!next
              ? [1, 2].map((i) => <Skeleton key={i} className="h-14" />)
              : next.slice(1).map((r) => (
                  <Link key={r.slug} to={`/p/${r.slug}`} className="group rounded-xl border border-line bg-panel/40 p-3 transition-colors hover:border-accent/40">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium group-hover:text-accent">{r.title}</span>
                      <ArrowUpRight className="ml-auto size-4 shrink-0 text-faint group-hover:text-accent" />
                    </div>
                    <div className="mt-1 text-xs text-muted">{r.reason}</div>
                  </Link>
                ))}
          </div>
        </motion.div>

        {/* tracks */}
        <motion.div {...fade(5)} className={cx(card, 'lg:col-span-12')}>
          <div className="mb-4 flex items-center justify-between">
            <span className="eyebrow">Your tracks</span>
            <Link to="/problems" className="text-xs text-muted hover:text-ink">
              All problems →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {!tracks.length
              ? [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)
              : tracks.map((t) => (
                  <Link key={t.key} to={`/tracks/${t.key}`} className="group rounded-xl border border-line bg-panel/40 p-4 transition-colors hover:border-accent/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium group-hover:text-accent">{t.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        {t.solved}/{t.total}
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${(t.solved / t.total) * 100}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} className="h-full rounded-full bg-nebula" />
                    </div>
                  </Link>
                ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

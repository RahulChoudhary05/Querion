import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Copy, Flame, Gift, Share2, Trophy, Users } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { PageHeader } from '../components/AppShell';
import { Button, cx, EmptyState, Skeleton, toast } from '../components/ui';
import { api } from '../lib/api';
import { useStats } from '../lib/queries';
import { useSession } from '../lib/session';
import { Seo } from '../components/Seo';

function Heatmap({ data }: { data: { day: string; n: number }[] }) {
  const map = new Map(data.map((d) => [d.day, d.n]));
  const days = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 7 * 26 + 1 - d.getUTCDay());
    for (let i = 0; i < 7 * 26 + new Date().getUTCDay(); i++) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, []);
  const level = (n: number) => (n === 0 ? 'bg-panel-2' : n < 3 ? 'bg-accent/30' : n < 6 ? 'bg-accent/60' : 'bg-accent');
  return (
    <div className="overflow-x-auto">
      <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]">
        {days.map((d) => (
          <div key={d} title={`${d}: ${map.get(d) ?? 0} submissions`} className={cx('size-[11px] rounded-[3px]', level(map.get(d) ?? 0))} />
        ))}
      </div>
    </div>
  );
}

function Ring({ value, total, label, color }: { value: number; total: number; label: string; color: string }) {
  const pct = total ? value / total : 0;
  const c = 2 * Math.PI * 26;
  return (
    <div className="flex items-center gap-3">
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
        <circle cx="32" cy="32" r="26" fill="none" stroke="var(--panel-2)" strokeWidth="6" />
        <motion.circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }} transition={{ duration: 1, ease: 'easeOut' }} />
      </svg>
      <div>
        <div className="text-lg font-semibold">
          {value}
          <span className="text-sm font-normal text-faint">/{total}</span>
        </div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </div>
  );
}

export function Profile() {
  const { data, isLoading } = useStats();
  const { user } = useSession();
  const { hash } = useLocation();
  const referrals = useQuery({ queryKey: ['referrals'], queryFn: () => api<{ handle: string; invited: { handle: string; created_at: string; solved: number }[] }>('/me/referrals'), enabled: !!user });

  useEffect(() => {
    if (hash) document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  const link = user ? `${location.origin}/invite/${user.handle}` : '';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <Seo title="Your progress | Querion" description="Your SQL practice progress." path="/me" noindex />
      <PageHeader eyebrow={`@${user?.handle ?? ''}`} title="Your progress" />

      {isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
            <div className="rounded-2xl border border-line bg-panel p-5">
              <div className="flex items-center gap-2 text-sm text-warn">
                <Flame className="size-4" /> Current streak
              </div>
              <div className="mt-2 text-4xl font-semibold tracking-[-0.03em]">{data.streak} <span className="text-base font-normal text-muted">days</span></div>
              <p className="mt-1 text-xs text-muted">Submit anything today to keep it alive.</p>
            </div>
            <div className="grid gap-4 rounded-2xl border border-line bg-panel p-5 sm:grid-cols-3">
              <Ring value={data.solved.Easy ?? 0} total={data.totals.Easy ?? 0} label="Easy" color="var(--easy)" />
              <Ring value={data.solved.Medium ?? 0} total={data.totals.Medium ?? 0} label="Medium" color="var(--medium)" />
              <Ring value={data.solved.Hard ?? 0} total={data.totals.Hard ?? 0} label="Hard" color="var(--hard)" />
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
            <div className="mb-3 text-sm font-medium">Activity — last 6 months</div>
            <Heatmap data={data.heatmap} />
          </div>
          <div className="mt-4 rounded-2xl border border-line bg-panel p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Trophy className="size-4 text-accent" /> Topics mastered
            </div>
            {data.topics.length === 0 ? (
              <EmptyState icon={<Trophy className="size-5" />} title="Nothing mastered yet" body="Solve a problem and its topics show up here." action={<Link to="/problems"><Button size="sm" variant="primary">Find a problem</Button></Link>} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.topics.map((t) => (
                  <span key={t.topic} className="rounded-full border border-line px-3 py-1 text-xs">
                    {t.topic} <b className="ml-1 text-accent">{t.n}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* referral */}
      <div id="invite" className="mt-4 scroll-mt-6 rounded-2xl border border-accent/25 bg-gradient-to-br from-accent-soft to-transparent p-5">
        <div className="flex items-center gap-2 font-medium">
          <Gift className="size-4 text-accent" /> Invite friends, climb together
        </div>
        <p className="mt-1 text-sm text-muted">Share your link — friends who join show up here, and you can race each other up the tracks.</p>
        {user ? (
          <>
            <div className="mt-3 flex gap-2">
              <input readOnly value={link} className="h-10 flex-1 rounded-xl border border-line bg-panel px-3 font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button icon={<Copy className="size-4" />} onClick={() => { void navigator.clipboard.writeText(link); toast.success('Invite link copied'); }}>Copy</Button>
              {'share' in navigator && <Button icon={<Share2 className="size-4" />} onClick={() => navigator.share({ title: 'Querion', text: 'Practise SQL on real data with me', url: link })} aria-label="Share" />}
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-muted">
              <Users className="size-4" /> {referrals.data?.invited.length ?? 0} friends joined
            </div>
            {!!referrals.data?.invited.length && (
              <div className="mt-2 grid gap-1">
                {referrals.data.invited.map((f) => (
                  <div key={f.handle} className="flex justify-between rounded-lg bg-panel px-3 py-2 text-sm">
                    <span>@{f.handle}</span>
                    <span className="text-muted">{f.solved} solved</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <Link to="/signup"><Button size="sm" variant="primary" className="mt-3">Sign up to get your link</Button></Link>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Password, devices, email and local data live in <Link to="/settings" className="text-accent hover:underline">Settings</Link>.
      </p>
    </div>
  );
}

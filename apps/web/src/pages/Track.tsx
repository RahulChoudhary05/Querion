import { motion } from 'motion/react';
import { ArrowRight, Check, Lock, Sparkles } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { PageHeader } from '../components/AppShell';
import { cx, DifficultyPill, EmptyState, Skeleton } from '../components/ui';
import { useTrack } from '../lib/queries';
import { NotFound } from './NotFound';
import { Seo } from '../components/Seo';

/** A dataset as a learning ladder — six tiers, progress per tier, the next rung highlighted. */
export function Track() {
  const { key = '' } = useParams();
  const { data, isLoading, error } = useTrack(key);
  if (error) return <NotFound />;
  if (isLoading || !data)
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-4 py-8 md:px-8">
        <Skeleton className="h-10 w-1/2" />
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  const all = data.tiers.flatMap((t) => t.problems);
  const solved = all.filter((p) => p.status === 'solved').length;
  const nextSlug = all.find((p) => p.status !== 'solved')?.slug;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <Seo title={`${data.dataset.name} SQL Track — 6 Tiers | Querion`} description={`${data.dataset.tagline} Climb from Foundations to Architect with verified SQL problems.`} path={`/tracks/${key}`} jsonLd={{ '@type': 'Course', name: `${data.dataset.name} SQL track`, description: data.dataset.tagline, provider: { '@type': 'Organization', name: 'Querion' } }} />
      <PageHeader eyebrow={`${data.dataset.domain} track`} title={data.dataset.name}>
        {data.dataset.tagline}
      </PageHeader>
      <div className="mb-8 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-panel p-4">
        <div className="min-w-48 flex-1">
          <div className="mb-1.5 flex justify-between text-xs text-muted">
            <span>Track progress</span>
            <span>{solved}/{all.length}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-panel-2">
            <motion.div initial={{ width: 0 }} animate={{ width: `${all.length ? (solved / all.length) * 100 : 0}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} className="h-full rounded-full bg-nebula" />
          </div>
        </div>
        <div className="text-xs text-muted">
          {data.dataset.tables.length} tables · {data.dataset.tables.reduce((s, t) => s + t.rowCount, 0).toLocaleString()} rows ·{' '}
          {data.dataset.source.kind === 'kaggle' ? (
            <a className="text-accent hover:underline" href={data.dataset.source.url} target="_blank" rel="noreferrer">Kaggle source</a>
          ) : (
            'synthetic'
          )}
        </div>
      </div>

      <ol className="relative space-y-4 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-px before:bg-line">
        {data.tiers.map((t, i) => {
          const done = t.problems.length > 0 && t.problems.every((p) => p.status === 'solved');
          return (
            <motion.li key={t.tier} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative pl-14">
              <span className={cx('absolute left-0 top-1 grid size-10 place-items-center rounded-xl border font-mono text-sm font-bold', done ? 'border-ok/40 bg-ok/10 text-ok' : t.tier === 6 ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-panel text-muted')}>
                {done ? <Check className="size-4" /> : `T${t.tier}`}
              </span>
              <div className="rounded-2xl border border-line bg-panel p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="font-semibold">{t.name}</h3>
                  <span className="text-xs text-muted">{t.blurb}</span>
                </div>
                {t.problems.length === 0 ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-faint">
                    <Lock className="size-3.5" /> New problems for this tier arrive with the next weekly forge.
                  </div>
                ) : (
                  <div className="mt-3 grid gap-1">
                    {t.problems.map((p) => (
                      <Link key={p.slug} to={`/p/${p.slug}`} className={cx('group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-panel-2', p.slug === nextSlug && 'bg-accent-soft ring-1 ring-accent/30')}>
                        <span className={cx('grid size-5 place-items-center rounded-full border', p.status === 'solved' ? 'border-ok bg-ok text-[#04140b]' : p.status ? 'border-warn' : 'border-line-strong')}>
                          {p.status === 'solved' && <Check className="size-3" />}
                        </span>
                        <span className="truncate group-hover:text-accent">{p.title}</span>
                        {p.origin === 'ai' && <Sparkles className="size-3.5 shrink-0 text-accent" />}
                        {p.slug === nextSlug && <span className="text-[11px] font-medium text-accent">Up next</span>}
                        <DifficultyPill d={p.difficulty} className="ml-auto" />
                        <ArrowRight className="size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>
      {all.length === 0 && <EmptyState icon={<Sparkles className="size-5" />} title="This track is brand new" body="Nebula is forging its first problems." />}
    </div>
  );
}

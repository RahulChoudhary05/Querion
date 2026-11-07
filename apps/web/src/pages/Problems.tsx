import { AnimatePresence, motion } from 'motion/react';
import { Bookmark, BookmarkMinus, FilterX, Search, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '../components/AppShell';
import { DataTable, type Column } from '../components/DataTable';
import { Button, Chip, cx, DifficultyPill, EmptyState, Skeleton, StatusDot, TierBadge, toast } from '../components/ui';
import type { ProblemListItem } from '../lib/api';
import { useDebounced, timeAgo } from '../lib/hooks';
import { useMeta, useProblems } from '../lib/queries';
import { useApp } from '../lib/store';
import { Seo } from '../components/Seo';

/** Every filter lives in the URL, so views are shareable and survive refresh/back. */
export function Problems() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { data, isLoading } = useProblems();
  const { data: meta } = useMeta();
  const queue = useApp((s) => s.queue);
  const toggleQueue = useApp((s) => s.toggleQueue);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search, 200);

  const get = (k: string) => params.get(k)?.split(',').filter(Boolean) ?? [];
  const set = (k: string, values: string[]) => {
    const p = new URLSearchParams(params);
    if (values.length) p.set(k, values.join(','));
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const toggle = (k: string, v: string) => set(k, get(k).includes(v) ? get(k).filter((x) => x !== v) : [...get(k), v]);

  const difficulty = get('difficulty');
  const domain = get('domain');
  const tier = get('tier');
  const topic = get('topic');
  const status = params.get('status') ?? '';
  const origin = params.get('origin') ?? '';
  const cadence = params.get('cadence') ?? '';
  const onlyQueue = params.get('queue') === '1';
  const activeFilters = difficulty.length + domain.length + tier.length + topic.length + (status ? 1 : 0) + (origin ? 1 : 0) + (cadence ? 1 : 0) + (onlyQueue ? 1 : 0) + (q ? 1 : 0);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (p) =>
        (!difficulty.length || difficulty.includes(p.difficulty)) &&
        (!domain.length || domain.includes(p.domain)) &&
        (!tier.length || tier.includes(String(p.tier))) &&
        (!topic.length || topic.some((t) => p.topics.includes(t))) &&
        (!status || (status === 'todo' ? !p.status : p.status === status)) &&
        (!origin || p.origin === origin) &&
        (!cadence || p.cadence === cadence) &&
        (!onlyQueue || queue.includes(p.slug)) &&
        (!needle || `${p.title} ${p.topics.join(' ')} ${p.datasetName}`.toLowerCase().includes(needle))
    );
  }, [data, q, difficulty, domain, tier, topic, status, origin, cadence, onlyQueue, queue]);

  const solved = (data ?? []).filter((p) => p.status === 'solved').length;

  const columns: Column<ProblemListItem>[] = [
    { key: 'status', header: '', cell: (p) => <StatusDot status={p.status} />, className: 'w-8 pr-0' },
    {
      key: 'title',
      header: 'Problem',
      sort: (p) => p.title,
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium group-hover:text-accent">{p.title}</span>
          {p.origin === 'ai' && (
            <span title="Forged by Nebula & verified on real Postgres" className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
              <Sparkles className="size-3" /> fresh
            </span>
          )}
          {queue.includes(p.slug) && <Bookmark className="size-3.5 shrink-0 fill-accent text-accent" />}
        </div>
      ),
    },
    { key: 'tier', header: 'Tier', sort: (p) => p.tier, cell: (p) => <TierBadge tier={p.tier} />, className: 'w-16' },
    { key: 'dataset', header: 'Dataset', sort: (p) => p.datasetName, cell: (p) => <span className="text-muted">{p.datasetName}</span>, hideBelow: 'md' },
    { key: 'topics', header: 'Topics', cell: (p) => <span className="text-[12.5px] text-faint">{p.topics.slice(0, 2).join(' · ')}</span>, hideBelow: 'lg' },
    { key: 'solved', header: 'Solved by', sort: (p) => p.solved_by, cell: (p) => <span className="font-mono text-xs text-muted">{p.solved_by}</span>, hideBelow: 'lg', className: 'w-24' },
    { key: 'difficulty', header: 'Difficulty', sort: (p) => ['Easy', 'Medium', 'Hard'].indexOf(p.difficulty), cell: (p) => <DifficultyPill d={p.difficulty} />, className: 'w-24' },
    { key: 'added', header: 'Added', sort: (p) => p.forged_for ?? '', cell: (p) => <span className="text-xs text-faint">{p.forged_for ? timeAgo(p.forged_for) : 'core'}</span>, hideBelow: 'md', className: 'w-24' },
  ];

  const bulk = (on: boolean) => {
    const slugs = [...selected];
    toggleQueue(slugs, on);
    setSelected(new Set());
    toast.success(on ? `Added ${slugs.length} to your queue` : `Removed ${slugs.length} from your queue`, undefined, {
      label: 'Undo',
      onClick: () => toggleQueue(slugs, !on),
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <Seo title="SQL Practice Problems — Easy to Architect | Querion" description="Browse verified SQL problems on real datasets: transport, automotive, engineering, healthcare, commerce, sports and media. Filter by tier, topic and difficulty." path="/problems" />
      <PageHeader
        eyebrow={`${solved} / ${data?.length ?? '–'} solved`}
        title="Problems"
        actions={
          <Chip active={onlyQueue} onClick={() => set('queue', onlyQueue ? [] : ['1'])}>
            <Bookmark className="size-3.5" /> My queue ({queue.length})
          </Chip>
        }
      >
        Every problem runs on real PostgreSQL and is judged against hidden datasets. Filter by track, tier or topic.
      </PageHeader>

      {/* filters */}
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-line bg-panel p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                const p = new URLSearchParams(params);
                if (e.target.value) p.set('q', e.target.value);
                else p.delete('q');
                setParams(p, { replace: true });
              }}
              placeholder="Search by title, topic or dataset…"
              className="h-10 w-full rounded-xl border border-line bg-panel-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
          </div>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" icon={<FilterX className="size-4" />} onClick={() => { setParams({}, { replace: true }); setSearch(''); }}>
              Clear {activeFilters}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['Easy', 'Medium', 'Hard'] as const).map((d) => (
            <Chip key={d} active={difficulty.includes(d)} onClick={() => toggle('difficulty', d)}>{d}</Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          {[1, 2, 3, 4, 5, 6].map((t) => (
            <Chip key={t} active={tier.includes(String(t))} onClick={() => toggle('tier', String(t))}>
              T{t}
              <span className="max-sm:hidden">{meta?.tiers.find((x) => x.tier === t)?.name}</span>
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          {[['', 'All'], ['todo', 'To do'], ['attempted', 'Attempted'], ['solved', 'Solved']].map(([v, l]) => (
            <Chip key={v} active={status === v} onClick={() => set('status', v ? [v] : [])}>{l}</Chip>
          ))}
          <Chip active={origin === 'ai'} onClick={() => set('origin', origin === 'ai' ? [] : ['ai'])}>
            <Sparkles className="size-3" /> Fresh only
          </Chip>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(meta?.domains ?? []).filter((d) => d.datasets.length).map((d) => (
            <Chip key={d.key} active={domain.includes(d.key)} onClick={() => toggle('domain', d.key)}>
              <span className="size-1.5 rounded-full" style={{ background: `oklch(0.72 0.15 ${d.hue})` }} />
              {d.label}
              <span className="text-faint">{d.problems}</span>
            </Chip>
          ))}
        </div>
        <details className="group">
          <summary className="cursor-pointer list-none text-xs text-faint hover:text-muted">
            <span className="group-open:hidden">+ Filter by topic{topic.length ? ` (${topic.length})` : ''}</span>
            <span className="hidden group-open:inline">− Topics</span>
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(meta?.topics ?? []).map((t) => (
              <Chip key={t} active={topic.includes(t)} onClick={() => toggle('topic', t)}>{t}</Chip>
            ))}
          </div>
        </details>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(p) => p.slug}
          onRowClick={(p) => nav(`/p/${p.slug}`)}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          empty={
            <div className="rounded-2xl border border-dashed border-line">
              <EmptyState
                icon={<FilterX className="size-5" />}
                title="No problems match these filters"
                body={onlyQueue ? 'Your queue is empty — select problems and press “Add to queue”.' : 'Try removing a filter or two.'}
                action={<Button size="sm" onClick={() => { setParams({}); setSearch(''); }}>Clear filters</Button>}
              />
            </div>
          }
        />
      )}

      {/* bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 glass-strong items-center gap-2 rounded-2xl p-2 pl-4 max-md:bottom-20"
          >
            <span className="text-sm">
              <b>{selected.size}</b> selected
            </span>
            <Button size="sm" variant="primary" icon={<Bookmark className="size-3.5" />} onClick={() => bulk(true)}>Add to queue</Button>
            <Button size="sm" icon={<BookmarkMinus className="size-3.5" />} onClick={() => bulk(false)}>Remove</Button>
            <button onClick={() => setSelected(new Set())} className={cx('grid size-8 place-items-center rounded-lg text-muted hover:text-ink')} aria-label="Clear selection">
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

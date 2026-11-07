import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, BookOpen, ChevronDown, Database, Eye, History, KeyRound, Lightbulb, Link2, Lock, MessageCircleQuestion, Network, Send, ShieldCheck, Sparkles, Table2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import type { Dataset } from '@querion/engine';
import { Markdown } from '../../components/Markdown';
import { Button, confirmAction, cx, DifficultyPill, EmptyState, OrbitLoader, Skeleton, TierBadge, toast } from '../../components/ui';
import { api, type Problem } from '../../lib/api';
import { timeAgo } from '../../lib/hooks';
import { useSubmissions } from '../../lib/queries';
import { ResultGrid } from './ResultGrid';

const ERDiagram = lazy(() => import('./ERDiagram').then((m) => ({ default: m.ERDiagram })));

type Tab = 'description' | 'schema' | 'tutor' | 'submissions' | 'solution';

export function ProblemPanel({
  problem,
  dataset,
  sql,
  lastError,
  onInsert,
  onLoadSql,
}: {
  problem: Problem;
  dataset?: Dataset;
  sql: string;
  lastError?: string;
  onInsert: (s: string) => void;
  onLoadSql: (s: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('description');
  const tabs: { key: Tab; label: string; icon: typeof BookOpen }[] = [
    { key: 'description', label: 'Problem', icon: BookOpen },
    { key: 'schema', label: 'Schema', icon: Database },
    { key: 'tutor', label: 'Tutor', icon: Lightbulb },
    { key: 'submissions', label: 'History', icon: History },
    { key: 'solution', label: 'Solution', icon: problem.solved ? BadgeCheck : Lock },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} className={cx('relative flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors', tab === key ? 'text-ink' : 'text-muted hover:text-ink')}>
            {tab === key && <motion.span layoutId="ptab" className="absolute inset-0 rounded-lg bg-panel-2" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <Icon className={cx('relative size-3.5', tab === key && 'text-accent')} />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'description' && <Description problem={problem} />}
        {tab === 'schema' && (dataset ? <Schema dataset={dataset} onInsert={onInsert} /> : <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>)}
        {tab === 'tutor' && <Tutor problem={problem} sql={sql} lastError={lastError} />}
        {tab === 'submissions' && <Submissions slug={problem.slug} onLoad={onLoadSql} />}
        {tab === 'solution' && <Solution problem={problem} onLoad={onLoadSql} />}
      </div>
    </div>
  );
}

function Description({ problem }: { problem: Problem }) {
  return (
    <div className="p-5">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">{problem.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DifficultyPill d={problem.difficulty} />
        <TierBadge tier={problem.tier} showName />
        {problem.topics.map((t) => (
          <span key={t} className="rounded-md bg-panel-2 px-2 py-0.5 text-[11px] text-muted">{t}</span>
        ))}
      </div>
      {problem.origin === 'ai' && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent/25 bg-accent-soft p-3 text-[12.5px]">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
          <div>
            <b className="text-ink">Forged by Nebula</b>
            {problem.forgedFor && <span className="text-muted"> on {problem.forgedFor}</span>}
            <div className="text-muted">
              Reference verified on real PostgreSQL across {problem.tests.length} datasets
              {problem.quality.blindSolve === 'passed' && <> and independently re-solved by a second AI model from this statement alone</>}.
            </div>
          </div>
        </div>
      )}
      <Markdown className="mt-4 text-muted">{problem.statement}</Markdown>

      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Table2 className="size-4 text-accent" /> Expected output <span className="text-xs font-normal text-faint">(sample data{problem.sampleExpected && problem.sampleExpected.total > 50 ? `, first 50 of ${problem.sampleExpected.total}` : ''})</span>
        </div>
        {problem.sampleExpected && (
          <div className="max-h-72">
            <ResultGrid rs={problem.sampleExpected} compact toolbar={false} />
          </div>
        )}
        <p className="mt-2 text-xs text-faint">
          Columns in order: <span className="font-mono text-muted">{problem.outputColumns.join(', ')}</span> · {problem.orderMatters ? 'row order matters' : 'any row order'}
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-line p-3.5">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-ok" /> How you're judged
        </div>
        <div className="grid gap-1.5">
          {problem.tests.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-[12.5px] text-muted">
              {t.hidden ? <Eye className="size-3.5 text-faint" /> : <Table2 className="size-3.5 text-faint" />}
              {t.label} {t.hidden && <span className="text-faint">· hidden</span>}
            </div>
          ))}
          {problem.costBudget && (
            <div className="flex items-center gap-2 text-[12.5px] text-accent">
              <Sparkles className="size-3.5" /> Planner cost ≤ {problem.costBudget.toFixed(1)} (Architect budget)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Schema({ dataset, onInsert }: { dataset: Dataset; onInsert: (s: string) => void }) {
  const [view, setView] = useState<'list' | 'er'>('list');
  const [open, setOpen] = useState<string | null>(dataset.tables[0]?.name ?? null);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{dataset.name}</div>
          <div className="truncate text-xs text-muted">{dataset.source.kind === 'kaggle' ? `Kaggle · ${dataset.source.slug}` : 'Synthetic, deterministic'}</div>
        </div>
        <div className="flex rounded-lg border border-line p-0.5">
          {(['list', 'er'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cx('flex h-7 items-center gap-1 rounded-md px-2 text-xs', view === v ? 'bg-panel-2 text-ink' : 'text-muted')}>
              {v === 'list' ? <Table2 className="size-3.5" /> : <Network className="size-3.5" />}
              {v === 'list' ? 'Tables' : 'ER diagram'}
            </button>
          ))}
        </div>
      </div>
      <p className="px-4 pt-2 text-[12.5px] leading-relaxed text-muted">{dataset.description}</p>
      {view === 'er' ? (
        <div className="m-3 min-h-[380px] flex-1 overflow-hidden rounded-xl border border-line">
          <Suspense fallback={<Skeleton className="h-full" />}>
            <ERDiagram dataset={dataset} onPick={onInsert} />
          </Suspense>
        </div>
      ) : (
        <div className="space-y-2 p-3">
          {dataset.tables.map((t) => (
            <div key={t.name} className="overflow-hidden rounded-xl border border-line">
              <button onClick={() => setOpen(open === t.name ? null : t.name)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-panel-2">
                <Table2 className="size-4 text-accent" />
                <span className="font-mono text-[13px] font-semibold">{t.name}</span>
                <span className="truncate text-xs text-faint">{t.description}</span>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">{t.rows.length} rows</span>
                <ChevronDown className={cx('size-4 shrink-0 text-faint transition-transform', open === t.name && 'rotate-180')} />
              </button>
              <AnimatePresence initial={false}>
                {open === t.name && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="border-t border-line">
                      {t.columns.map((c) => (
                        <button key={c.name} onClick={() => onInsert(c.name)} title="Insert into editor" className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] hover:bg-accent-soft">
                          {c.pk ? <KeyRound className="size-3 text-warn" /> : c.ref ? <Link2 className="size-3 text-accent-2" /> : <span className="size-3" />}
                          <span>{c.name}</span>
                          <span className="text-faint">{c.type}</span>
                          {c.ref && <span className="text-accent-2">→ {c.ref}</span>}
                          {c.note && <span className="ml-auto truncate font-sans text-[11px] text-faint">{c.note}</span>}
                        </button>
                      ))}
                      <div className="border-t border-line p-2">
                        <div className="mb-1 px-1 text-[11px] text-faint">Preview (first 5 rows)</div>
                        <ResultGrid compact toolbar={false} rs={{ fields: t.columns.map((c) => ({ name: c.name, dataTypeID: /int/.test(c.type) ? 23 : /numeric/.test(c.type) ? 1700 : 25 })), rows: t.rows.slice(0, 5) }} />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const LEVELS = [
  { level: 1 as const, title: 'Nudge', body: 'Where to look' },
  { level: 2 as const, title: 'Concept', body: 'Which SQL ideas' },
  { level: 3 as const, title: 'Skeleton', body: 'Query with blanks' },
];

function Tutor({ problem, sql, lastError }: { problem: Problem; sql: string; lastError?: string }) {
  const [hints, setHints] = useState<Record<number, { text: string; source: string }>>({});
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string; provider: string }[]>([]);
  const hint = useMutation({
    mutationFn: (level: 1 | 2 | 3) => api<{ text: string; source: string }>('/ai/hint', { method: 'POST', json: { slug: problem.slug, level, sql, lastError } }),
    onSuccess: (r, level) => setHints((h) => ({ ...h, [level]: r })),
    onError: (e: Error) => toast.error('Hint unavailable', e.message),
  });
  const ask = useMutation({
    mutationFn: (q: string) => api<{ text: string; provider: string }>('/ai/ask', { method: 'POST', json: { slug: problem.slug, question: q, sql } }),
    onSuccess: (r, q) => setChat((c) => [...c, { q, a: r.text, provider: r.provider }]),
    onError: (e: Error) => toast.error('Tutor unavailable', e.message),
  });
  const unlocked = Math.max(0, ...Object.keys(hints).map(Number));
  return (
    <div className="p-5">
      <div className="mb-1 text-sm font-semibold">Hint ladder</div>
      <p className="mb-4 text-xs text-muted">Each step reveals a little more, personalised to the query in your editor. Try to stop at the earliest one that unblocks you.</p>
      <div className="space-y-2">
        {LEVELS.map(({ level, title, body }) => {
          const h = hints[level];
          const locked = level > unlocked + 1;
          return (
            <div key={level} className={cx('rounded-xl border p-3 transition-colors', h ? 'border-accent/30 bg-accent-soft/50' : 'border-line')}>
              <div className="flex items-center gap-3">
                <span className={cx('grid size-7 place-items-center rounded-lg font-mono text-xs font-bold', h ? 'bg-nebula' : 'bg-panel-2 text-muted')}>{level}</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-faint">{body}</div>
                </div>
                {!h && (
                  <Button size="sm" variant={locked ? 'ghost' : 'secondary'} disabled={locked} loading={hint.isPending && hint.variables === level} onClick={() => hint.mutate(level)}>
                    {locked ? <Lock className="size-3.5" /> : 'Reveal'}
                  </Button>
                )}
              </div>
              {h && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
                  <Markdown className="text-[13px] text-muted">{h.text}</Markdown>
                  <div className="mt-1 text-[10.5px] text-faint">{h.source === 'curated' ? 'Curated hint' : `Personalised by ${h.source}`}</div>
                </motion.div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 mb-2 flex items-center gap-2 text-sm font-semibold">
        <MessageCircleQuestion className="size-4 text-accent" /> Ask the tutor
      </div>
      <div className="space-y-3">
        {chat.map((c, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-panel-2 px-3 py-2 text-[13px]">{c.q}</div>
            <div className="rounded-2xl rounded-bl-md border border-line px-3 py-2">
              <Markdown className="text-[13px] text-muted">{c.a}</Markdown>
              <div className="text-[10.5px] text-faint">{c.provider}</div>
            </div>
          </div>
        ))}
        {ask.isPending && <OrbitLoader label="Thinking…" />}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length < 2) return;
          ask.mutate(question.trim());
          setQuestion('');
        }}
      >
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={800} placeholder="e.g. When should I use HAVING instead of WHERE?" className="h-10 flex-1 rounded-xl border border-line bg-panel-2 px-3 text-sm outline-none focus:border-accent" />
        <Button type="submit" variant="primary" disabled={question.trim().length < 2} loading={ask.isPending} icon={<Send className="size-4" />} aria-label="Ask" />
      </form>
    </div>
  );
}

function Submissions({ slug, onLoad }: { slug: string; onLoad: (s: string) => void }) {
  const { data, isLoading } = useSubmissions(slug);
  if (isLoading) return <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (!data?.length) return <EmptyState icon={<History className="size-5" />} title="No submissions yet" body="Your attempts appear here — click one to load it back into the editor." />;
  return (
    <div className="space-y-1.5 p-3">
      {data.map((s) => (
        <button key={s.id} onClick={() => onLoad(s.sql)} className="w-full rounded-xl border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-panel-2">
          <div className="flex items-center gap-2 text-sm">
            <span className={cx('font-medium', s.verdict === 'ACCEPTED' ? 'text-ok' : s.verdict === 'INEFFICIENT' ? 'text-warn' : 'text-bad')}>{s.verdict.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
            <span className="text-xs text-faint">{s.passed}/{s.total} tests</span>
            {s.plan_cost !== null && <span className="font-mono text-[11px] text-faint">cost {Number(s.plan_cost).toFixed(1)}</span>}
            <span className="ml-auto text-xs text-faint">{timeAgo(s.created_at)}</span>
          </div>
          <pre className="mt-1.5 truncate font-mono text-[11.5px] text-muted">{s.sql.replace(/\s+/g, ' ')}</pre>
        </button>
      ))}
    </div>
  );
}

function Solution({ problem, onLoad }: { problem: Problem; onLoad: (s: string) => void }) {
  const [reveal, setReveal] = useState(false);
  const q = useQuery({
    queryKey: ['solution', problem.slug, problem.solved, reveal],
    queryFn: () => api<{ sql: string; explanation: string }>(`/problems/${problem.slug}/solution${reveal ? '?reveal=1' : ''}`),
    enabled: problem.solved || reveal,
    retry: false,
  });
  if (!problem.solved && !reveal)
    return (
      <EmptyState
        icon={<Lock className="size-5" />}
        title="Solution locked"
        body="Solve it to unlock the reference query, the explanation and an AI code review of your answer. Struggling? The tutor's hint ladder is gentler."
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (await confirmAction({ title: 'Reveal the solution?', body: 'Looking now removes the learning moment. You can still submit afterwards, but try the level 3 hint first.', confirm: 'Reveal anyway' })) setReveal(true);
            }}
          >
            Reveal anyway
          </Button>
        }
      />
    );
  if (q.isLoading) return <div className="p-4"><Skeleton className="h-40" /></div>;
  if (!q.data) return null;
  return (
    <div className="p-5">
      <div className="mb-2 text-sm font-semibold">Reference solution</div>
      <pre className="overflow-x-auto rounded-xl border border-line bg-panel-2 p-4 font-mono text-[12.5px] leading-relaxed">{q.data.sql}</pre>
      <Button size="sm" className="mt-2" onClick={() => onLoad(q.data!.sql)}>Load into editor</Button>
      <div className="mt-5 mb-1 text-sm font-semibold">Why this is optimal</div>
      <Markdown className="text-muted">{q.data.explanation}</Markdown>
    </div>
  );
}

import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Gauge, Lightbulb, ListChecks, Play, Sparkles, Terminal, Wand2, XCircle, Zap } from 'lucide-react';
import { compareResults, explainError, type Dataset, type ExecOutcome, type JudgeReport, type PlanNode, type SqlError } from '@querion/engine';
import { Markdown } from '../../components/Markdown';
import { Button, cx, EmptyState, Kbd, OrbitLoader, toast } from '../../components/ui';
import { api, type Problem, type Review } from '../../lib/api';
import { modKey } from '../../lib/hooks';
import { PlanTree } from './PlanTree';
import { ResultGrid } from './ResultGrid';

export type ConsoleTab = 'result' | 'verdict' | 'plan';

export interface ConsoleState {
  run: { status: 'idle' | 'running' | 'done'; out?: ExecOutcome; sql?: string };
  judge: { status: 'idle' | 'judging' | 'done'; report?: JudgeReport; sql?: string; firstSolve?: boolean };
  plan: { status: 'idle' | 'loading' | 'done'; plan?: PlanNode; executionMs?: number; error?: SqlError };
}

const VERDICT_UI: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  ACCEPTED: { label: 'Accepted', tone: 'text-ok', icon: CheckCircle2 },
  WRONG_ANSWER: { label: 'Wrong answer', tone: 'text-bad', icon: XCircle },
  RUNTIME_ERROR: { label: 'Runtime error', tone: 'text-bad', icon: AlertTriangle },
  TIME_LIMIT: { label: 'Time limit exceeded', tone: 'text-warn', icon: Clock },
  REJECTED: { label: 'Query blocked', tone: 'text-warn', icon: CircleSlash },
  INEFFICIENT: { label: 'Correct, but over budget', tone: 'text-warn', icon: Gauge },
};

export function ConsolePanel({
  tab,
  setTab,
  state,
  problem,
  dataset,
  onFixLine,
  onExplain,
}: {
  tab: ConsoleTab;
  setTab: (t: ConsoleTab) => void;
  state: ConsoleState;
  problem: Problem;
  dataset?: Dataset;
  onFixLine: (line: number | null) => void;
  onExplain: () => void;
}) {
  const tabs: { key: ConsoleTab; label: string; icon: typeof Terminal; dot?: string }[] = [
    { key: 'result', label: 'Result', icon: Terminal, dot: state.run.out ? (state.run.out.ok ? 'bg-ok' : 'bg-bad') : undefined },
    { key: 'verdict', label: 'Tests', icon: ListChecks, dot: state.judge.report ? (state.judge.report.verdict === 'ACCEPTED' ? 'bg-ok' : 'bg-bad') : undefined },
    { key: 'plan', label: 'Query plan', icon: Gauge },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line px-2">
        {tabs.map(({ key, label, icon: Icon, dot }) => (
          <button key={key} onClick={() => setTab(key)} className={cx('relative flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px]', tab === key ? 'text-ink' : 'text-muted hover:text-ink')}>
            {tab === key && <motion.span layoutId="ctab" className="absolute inset-0 rounded-lg bg-panel-2" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <Icon className={cx('relative size-3.5', tab === key && 'text-accent')} />
            <span className="relative">{label}</span>
            {dot && <span className={cx('relative size-1.5 rounded-full', dot)} />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'result' && <ResultTab state={state} problem={problem} dataset={dataset} onFixLine={onFixLine} onExplain={onExplain} />}
        {tab === 'verdict' && <VerdictTab state={state} problem={problem} />}
        {tab === 'plan' && <PlanTab state={state} />}
      </div>
    </div>
  );
}

function ResultTab({ state, problem, dataset, onFixLine, onExplain }: { state: ConsoleState; problem: Problem; dataset?: Dataset; onFixLine: (l: number | null) => void; onExplain: () => void }) {
  const { run } = state;
  if (run.status === 'idle')
    return (
      <EmptyState
        icon={<Play className="size-5" />}
        title="Run your query to see results"
        body="Runs instantly on real PostgreSQL inside your browser — nothing leaves your machine."
        action={<span className="flex items-center gap-1 text-xs text-faint"><Kbd>{modKey}</Kbd><Kbd>↵</Kbd> run · <Kbd>{modKey}</Kbd><Kbd>⇧</Kbd><Kbd>↵</Kbd> submit</span>}
      />
    );
  if (run.status === 'running') return <OrbitLoader label="Executing on PostgreSQL…" />;
  const out = run.out!;
  if (!out.ok) return <ErrorCard error={out.error} sql={run.sql ?? ''} dataset={dataset} problem={problem} onFixLine={onFixLine} onExplain={onExplain} />;
  const sample = problem.sampleExpected;
  const cmp = sample && sample.total === sample.rows.length ? compareResults(sample, out.result, problem.orderMatters) : null;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 px-1 text-xs">
        <span className="text-muted">
          <b className="text-ink">{out.result.rows.length}</b> row{out.result.rows.length === 1 ? '' : 's'}
          {out.result.truncated && ' (truncated)'} · {out.ms.toFixed(1)} ms
        </span>
        {cmp && (
          <span className={cx('flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', cmp.equal ? 'bg-ok/12 text-ok' : 'bg-warn/12 text-warn')}>
            {cmp.equal ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {cmp.equal ? 'Matches the sample output — now Submit to face the hidden tests' : cmp.message}
          </span>
        )}
      </div>
      {out.result.fields.length ? <ResultGrid rs={out.result} /> : <div className="p-4 text-sm text-muted">Query returned no columns.</div>}
    </div>
  );
}

function ErrorCard({ error, sql, dataset, problem, onFixLine, onExplain }: { error: SqlError; sql: string; dataset?: Dataset; problem: Problem; onFixLine: (l: number | null) => void; onExplain: () => void }) {
  const insight = explainError(error, sql, dataset);
  const ai = useMutation({
    mutationFn: () => api<{ ai: { text: string; provider: string } | null }>('/ai/explain', { method: 'POST', json: { slug: problem.slug, sql, error } }),
    onError: (e: Error) => toast.error('AI explanation unavailable', e.message),
  });
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-bad/30 bg-bad/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-bad" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{insight.title}</div>
            <p className="mt-1 text-sm text-muted">{insight.explanation}</p>
            {insight.suggestions.length > 0 && (
              <ul className="mt-2 space-y-1">
                {insight.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[13px]">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warn" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {insight.line && (
                <Button size="sm" variant="ghost" onClick={() => onFixLine(insight.line!)}>
                  Jump to line {insight.line}
                </Button>
              )}
              <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={ai.isPending} onClick={() => { ai.mutate(); onExplain(); }}>
                Explain with AI
              </Button>
              <span className="font-mono text-[11px] text-faint">{error.code ? `SQLSTATE ${error.code}` : error.phase}</span>
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {ai.data?.ai && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-accent/25 bg-accent-soft/60 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-accent">
              <Sparkles className="size-3.5" /> Tutor · {ai.data.ai.provider}
            </div>
            <Markdown className="text-[13px] text-muted">{ai.data.ai.text}</Markdown>
          </motion.div>
        )}
      </AnimatePresence>
      <details className="text-xs text-faint">
        <summary className="cursor-pointer">Raw Postgres message</summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono">{error.message}{error.detail ? `\n${error.detail}` : ''}{error.hint ? `\nHINT: ${error.hint}` : ''}</pre>
      </details>
    </div>
  );
}

function VerdictTab({ state, problem }: { state: ConsoleState; problem: Problem }) {
  const { judge } = state;
  const review = useMutation({
    mutationFn: () => api<Review>('/ai/review', { method: 'POST', json: { slug: problem.slug, sql: judge.sql, report: judge.report } }),
    onError: (e: Error) => toast.error('Review unavailable', e.message),
  });
  const explain = useMutation({
    mutationFn: () => api<{ ai: { text: string; provider: string } | null }>('/ai/explain', { method: 'POST', json: { slug: problem.slug, sql: judge.sql, report: judge.report } }),
  });
  if (judge.status === 'idle') return <EmptyState icon={<ListChecks className="size-5" />} title="Submit to run the hidden tests" body={`Your query will be checked on ${problem.tests.length} datasets, including ${problem.tests.filter((t) => t.hidden).length} you can't see.`} />;

  // optimistic pending view: show every test as queued while the judge works
  const cases = judge.status === 'judging' ? problem.tests.map((t) => ({ caseId: t.id, label: t.label, hidden: t.hidden, verdict: 'PENDING' as const, ms: 0 })) : judge.report!.cases;
  const report = judge.report;
  const v = report ? VERDICT_UI[report.verdict] : null;
  const eff = report?.efficiency;

  return (
    <div className="space-y-3">
      {judge.status === 'judging' ? (
        <OrbitLoader label="Judging against hidden datasets…" />
      ) : (
        v && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3">
            <v.icon className={cx('size-6', v.tone)} />
            <div>
              <div className={cx('text-lg font-semibold', v.tone)}>{v.label}</div>
              <div className="text-xs text-muted">
                {report!.passed}/{report!.total} tests passed · {report!.ms.toFixed(0)} ms{judge.firstSolve && ' · first solve'}
              </div>
            </div>
          </motion.div>
        )
      )}

      <div className="grid gap-1.5 sm:grid-cols-2">
        {cases.map((c, i) => {
          const pending = c.verdict === 'PENDING';
          const ok = c.verdict === 'ACCEPTED';
          return (
            <motion.div
              key={c.caseId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className={cx('flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm', pending ? 'border-line' : ok ? 'border-ok/30 bg-ok/5' : 'border-bad/30 bg-bad/5')}
            >
              {pending ? <span className="size-4 animate-pulse rounded-full bg-line-strong" /> : ok ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className={cx('size-4', c.verdict === 'INEFFICIENT' ? 'text-warn' : 'text-bad')} />}
              <span className="flex-1">{c.label}</span>
              {c.hidden && <span className="text-[10.5px] text-faint">hidden</span>}
              {!pending && c.ms > 0 && <span className="font-mono text-[10.5px] text-faint">{c.ms.toFixed(0)}ms</span>}
            </motion.div>
          );
        })}
      </div>

      {report && report.verdict !== 'ACCEPTED' && (() => {
        const failing = report.cases.find((c) => c.verdict !== 'ACCEPTED');
        if (!failing) return null;
        const d = failing.diff;
        return (
          <div className="rounded-xl border border-line p-3.5">
            <div className="text-sm font-medium">{failing.label}</div>
            <p className="mt-1 text-[13px] text-muted">{failing.message}</p>
            {d && (d.missing.length > 0 || d.extra.length > 0) && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <DiffBlock title="Expected but missing" tone="ok" columns={d.expectedColumns} rows={d.missing} />
                <DiffBlock title="Returned but not expected" tone="bad" columns={d.actualColumns} rows={d.extra} />
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={explain.isPending} onClick={() => explain.mutate()}>
                Why is this wrong?
              </Button>
            </div>
            {explain.data?.ai && (
              <div className="mt-3 rounded-xl border border-accent/25 bg-accent-soft/60 p-3">
                <Markdown className="text-[13px] text-muted">{explain.data.ai.text}</Markdown>
              </div>
            )}
          </div>
        );
      })()}

      {eff && (
        <div className="rounded-xl border border-line p-3.5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Zap className="size-4 text-accent" /> Efficiency vs reference
          </div>
          <EfficiencyBar user={eff.userCost} reference={eff.referenceCost} budget={eff.budget ?? undefined} />
        </div>
      )}

      {report?.verdict === 'ACCEPTED' && (
        <div className="rounded-xl border border-accent/25 bg-accent-soft/40 p-3.5">
          {!review.data ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <b>Get a senior-engineer code review</b>
                <div className="text-xs text-muted">Readability, NULL-safety, performance and an alternative approach.</div>
              </div>
              <Button size="sm" variant="primary" icon={<Sparkles className="size-3.5" />} loading={review.isPending} onClick={() => review.mutate()}>
                Review my SQL
              </Button>
            </div>
          ) : (
            <div className="space-y-2 text-[13px]">
              <div className="font-medium">{review.data.verdict_summary}</div>
              {review.data.strengths.length > 0 && <ul className="list-disc pl-5 text-muted">{review.data.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>}
              {review.data.improvements.length > 0 && (
                <>
                  <div className="font-medium">Improve</div>
                  <ul className="list-disc pl-5 text-muted">{review.data.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </>
              )}
              <p className="text-muted"><b className="text-ink">Execution:</b> {review.data.complexity}</p>
              {review.data.alternative_approach && <p className="text-muted"><b className="text-ink">Alternative:</b> {review.data.alternative_approach}</p>}
              {review.data.alternative_sql && <pre className="overflow-x-auto rounded-lg bg-panel-2 p-3 font-mono text-[12px]">{review.data.alternative_sql}</pre>}
              <div className="text-[10.5px] text-faint">Reviewed by {review.data.provider}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffBlock({ title, tone, columns, rows }: { title: string; tone: 'ok' | 'bad'; columns: string[]; rows: string[][] }) {
  return (
    <div className={cx('overflow-hidden rounded-lg border', tone === 'ok' ? 'border-ok/30' : 'border-bad/30')}>
      <div className={cx('px-3 py-1.5 text-xs font-medium', tone === 'ok' ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>
        {tone === 'ok' ? '+' : '−'} {title} ({rows.length})
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[11.5px]">
            <thead>
              <tr className="text-faint">{columns.map((c) => <th key={c} className="px-2 py-1 text-left font-normal">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line/60">{r.map((v, j) => <td key={j} className="px-2 py-1">{v === '∅' ? <i className="text-faint">NULL</i> : v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-3 py-2 text-xs text-faint">None</div>
      )}
    </div>
  );
}

function EfficiencyBar({ user, reference, budget }: { user: number; reference: number; budget?: number }) {
  const max = Math.max(user, reference, budget ?? 0) * 1.1 || 1;
  const ratio = reference ? user / reference : 1;
  const bar = (label: string, value: number, cls: string) => (
    <div className="grid grid-cols-[80px_1fr_70px] items-center gap-3 text-xs">
      <span className="text-muted">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
        <motion.div initial={{ width: 0 }} animate={{ width: `${(value / max) * 100}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} className={cx('h-full rounded-full', cls)} />
      </div>
      <span className="text-right font-mono">{value.toFixed(1)}</span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {bar('Your plan', user, ratio <= 1.05 ? 'bg-ok' : ratio <= 1.6 ? 'bg-warn' : 'bg-bad')}
      {bar('Reference', reference, 'bg-accent')}
      {budget !== undefined && bar('Budget', budget, 'bg-line-strong')}
      <p className="pt-1 text-xs text-muted">
        {ratio <= 0.95 ? `Your plan is ${((1 - ratio) * 100).toFixed(0)}% cheaper than the reference.` : ratio <= 1.05 ? 'Optimal — same cost as the reference plan.' : `Your plan costs ${ratio.toFixed(2)}× the reference. Check the Query plan tab for the expensive node.`}
      </p>
    </div>
  );
}

function PlanTab({ state }: { state: ConsoleState }) {
  const { plan } = state;
  if (plan.status === 'idle') return <EmptyState icon={<Gauge className="size-5" />} title="See how Postgres executes your query" body="Run a query, then open this tab — it shows EXPLAIN ANALYZE with cost hotspots." />;
  if (plan.status === 'loading') return <OrbitLoader label="Planning…" />;
  if (plan.error) return <p className="p-3 text-sm text-bad">{plan.error.message}</p>;
  return plan.plan ? <PlanTree plan={plan.plan} executionMs={plan.executionMs} /> : null;
}

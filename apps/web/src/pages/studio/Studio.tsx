import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Cloud, Code2, Database, FileText, Play, RotateCcw, Send, Terminal, WandSparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Link, useNavigate, useParams } from 'react-router';
import { format as formatSql } from 'sql-formatter';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { LogoMark } from '../../components/Logo';
import { Button, confirmAction, cx, DifficultyPill, Kbd, OrbitLoader, Skeleton, TierBadge, toast } from '../../components/ui';
import { api, ApiError, type JudgeReport, type ProblemListItem, type Problem } from '../../lib/api';
import { engine } from '../../lib/engine';
import { modKey, useDebounced, useThrottle } from '../../lib/hooks';
import { qk, useDataset, useProblem, useProblems } from '../../lib/queries';
import { useApp } from '../../lib/store';
import { NotFound } from '../NotFound';
import { ConsolePanel, type ConsoleState, type ConsoleTab } from './ConsolePanel';
import { ProblemPanel } from './ProblemPanel';
import { SqlEditor, type SqlEditorHandle } from './SqlEditor';
import { Seo } from '../../components/Seo';

const starter = (p: Problem, tables: string[]) => `-- ${p.title}\n-- Tables: ${tables.join(', ')}\n\nSELECT\n  \nFROM `;

function useIsDesktop() {
  const [d, setD] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)');
    const h = () => setD(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return d;
}

export function Studio() {
  const { slug = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: problem, isLoading, error } = useProblem(slug);
  const { data: dataset } = useDataset(problem?.datasetKey);
  const { data: list } = useProblems();
  const drafts = useApp((s) => s.drafts);
  const saveDraft = useApp((s) => s.saveDraft);
  const clearDraft = useApp((s) => s.clearDraft);
  const desktop = useIsDesktop();
  const editor = useRef<SqlEditorHandle>(null);

  const [sql, setSql] = useState('');
  const [engineReady, setEngineReady] = useState(false);
  const [tab, setTab] = useState<ConsoleTab>('result');
  const [mobileView, setMobileView] = useState<'problem' | 'code' | 'console'>('problem');
  const [state, setState] = useState<ConsoleState>({ run: { status: 'idle' }, judge: { status: 'idle' }, plan: { status: 'idle' } });
  const [celebrate, setCelebrate] = useState(false);
  const loadedFor = useRef<string | null>(null);

  // initialise editor from autosaved draft
  useEffect(() => {
    if (!problem || !dataset || loadedFor.current === slug) return;
    loadedFor.current = slug;
    setSql(drafts[slug]?.sql ?? starter(problem, dataset.tables.map((t) => t.name)));
    setState({ run: { status: 'idle' }, judge: { status: 'idle' }, plan: { status: 'idle' } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, dataset, slug]);

  // boot in-browser Postgres with this dataset
  useEffect(() => {
    if (!dataset) return;
    setEngineReady(false);
    engine
      .load(dataset)
      .then(() => setEngineReady(true))
      .catch((e) => toast.error('Could not start the in-browser engine', `${e.message}. Runs will use the server instead.`));
  }, [dataset]);

  // autosave (debounced)
  const debounced = useDebounced(sql, 600);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!problem || loadedFor.current !== slug || !debounced) return;
    if (drafts[slug]?.sql === debounced) return;
    saveDraft(slug, debounced);
    setSavedAt(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const index = useMemo(() => (list ?? []).findIndex((p) => p.slug === slug), [list, slug]);
  const prev = index > 0 ? list![index - 1] : null;
  const next = index >= 0 && list && index < list.length - 1 ? list[index + 1] : null;

  const explainNow = useCallback(
    async (text: string) => {
      if (!problem) return;
      setState((s) => ({ ...s, plan: { status: 'loading' } }));
      try {
        const r = await engine.explain(problem.datasetKey, text);
        setState((s) => ({ ...s, plan: r.ok ? { status: 'done', plan: r.plan, executionMs: r.executionMs } : { status: 'done', error: r.error } }));
      } catch (e) {
        setState((s) => ({ ...s, plan: { status: 'done', error: { message: (e as Error).message, phase: 'postgres' } } }));
      }
    },
    [problem]
  );

  const run = useThrottle(async () => {
    if (!problem) return;
    const text = editor.current?.getSelectionOrAll() ?? sql;
    editor.current?.markErrorLine(null);
    setState((s) => ({ ...s, run: { status: 'running', sql: text } }));
    if (tab === 'verdict') setTab('result');
    if (!desktop) setMobileView('console');
    try {
      const out = engineReady ? await engine.run(problem.datasetKey, text) : await api<import('@querion/engine').ExecOutcome>(`/problems/${slug}/run`, { method: 'POST', json: { sql: text } });
      setState((s) => ({ ...s, run: { status: 'done', out, sql: text } }));
      if (out.ok && tab === 'plan') void explainNow(text);
    } catch (e) {
      setState((s) => ({ ...s, run: { status: 'done', sql: text, out: { ok: false, ms: 0, error: { message: (e as Error).message, phase: 'postgres' } } } }));
    }
  }, 400);

  const submit = useMutation({
    mutationFn: (text: string) => api<{ report: JudgeReport; firstSolve: boolean; explanation: string | null }>(`/problems/${slug}/submit`, { method: 'POST', json: { sql: text } }),
    onMutate: (text) => {
      // optimistic: show the judge immediately with queued tests
      setState((s) => ({ ...s, judge: { status: 'judging', sql: text } }));
      setTab('verdict');
      if (!desktop) setMobileView('console');
      const prevList = qc.getQueryData<ProblemListItem[]>(qk.problems);
      if (prevList) qc.setQueryData(qk.problems, prevList.map((p) => (p.slug === slug && !p.status ? { ...p, status: 'attempted' as const } : p)));
      return { prevList };
    },
    onSuccess: (r, text) => {
      setState((s) => ({ ...s, judge: { status: 'done', report: r.report, sql: text, firstSolve: r.firstSolve } }));
      if (r.report.verdict === 'ACCEPTED') {
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 2200);
        qc.setQueryData<Problem>(qk.problem(slug), (p) => (p ? { ...p, solved: true, explanation: r.explanation } : p));
        qc.setQueryData<ProblemListItem[]>(qk.problems, (l) => l?.map((p) => (p.slug === slug ? { ...p, status: 'solved', solved_by: p.solved_by + (r.firstSolve ? 1 : 0) } : p)));
        if (r.firstSolve) toast.success('Accepted — first solve!', 'Your solution passed every hidden test.', next ? { label: `Next: ${next.title}`, onClick: () => nav(`/p/${next.slug}`) } : undefined);
      }
      void qc.invalidateQueries({ queryKey: qk.submissions(slug) });
      void qc.invalidateQueries({ queryKey: qk.stats });
      void qc.invalidateQueries({ queryKey: qk.next });
    },
    onError: (e: Error, text, ctx) => {
      if (ctx?.prevList) qc.setQueryData(qk.problems, ctx.prevList); // roll back optimistic status
      setState((s) => ({ ...s, judge: { status: 'idle' } }));
      toast.error(e instanceof ApiError && e.status === 429 ? 'Too many submissions' : 'Submission failed', e.message, { label: 'Retry', onClick: () => submit.mutate(text) });
    },
  });

  const doSubmit = useThrottle(() => {
    if (submit.isPending) return;
    submit.mutate(editor.current?.getSelectionOrAll() ?? sql);
  }, 1200);

  const format = () => {
    try {
      setSql(formatSql(sql, { language: 'postgresql', keywordCase: 'upper', tabWidth: 2 }));
    } catch {
      toast.error('Could not format', 'Fix syntax errors first.');
    }
  };

  const reset = async () => {
    if (!problem || !dataset) return;
    if (await confirmAction({ title: 'Reset your code?', body: 'This replaces the editor with the starter template. Your submission history is kept.', confirm: 'Reset code' })) {
      const prevSql = sql;
      setSql(starter(problem, dataset.tables.map((t) => t.name)));
      clearDraft(slug);
      toast.info('Code reset', undefined, { label: 'Undo', onClick: () => setSql(prevSql) });
    }
  };

  if (error) return error instanceof ApiError && error.status === 404 ? <NotFound /> : <div className="p-8 text-bad">{(error as Error).message}</div>;

  const header = (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg-2 px-3">
      <Link to="/problems" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink" aria-label="Back to problems">
        <ArrowLeft className="size-4" />
      </Link>
      <div className="hidden md:block">
        <LogoMark size={22} animate={false} />
      </div>
      {problem ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{problem.title}</span>
          <DifficultyPill d={problem.difficulty} className="max-sm:hidden" />
          <span className="max-sm:hidden">
            <TierBadge tier={problem.tier} />
          </span>
        </div>
      ) : (
        <Skeleton className="h-5 w-48" />
      )}
      <div className="ml-auto flex items-center gap-1">
        <button disabled={!prev} onClick={() => prev && nav(`/p/${prev.slug}`)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-30" aria-label="Previous problem" title={prev?.title}>
          <ChevronLeft className="size-4" />
        </button>
        <button disabled={!next} onClick={() => next && nav(`/p/${next.slug}`)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-30" aria-label="Next problem" title={next?.title}>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );

  const editorPane = (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-line px-3">
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[12px] text-muted" title={engineReady ? 'Running on PostgreSQL 17 in your browser' : 'Starting PostgreSQL in your browser…'}>
          <span className={cx('size-1.5 rounded-full', engineReady ? 'bg-ok shadow-[0_0_6px_var(--ok)]' : 'animate-pulse bg-faint')} />
          <Code2 className="size-3.5 text-accent" />
          pg17
          <span className={cx('hidden 2xl:inline', engineReady ? 'text-ok' : 'text-faint')}>{engineReady ? '· in-browser' : '· booting…'}</span>
        </span>
        <span className={cx('hidden items-center gap-1 text-[11px] transition-opacity xl:flex', savedAt ? 'text-faint' : 'opacity-0')} aria-live="polite">
          <Cloud className="size-3" /> Saved
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={format} title={`Format (${modKey}+S)`} icon={<WandSparkles className="size-3.5" />}>
            <span className="max-sm:hidden">Format</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={reset} title="Reset code" icon={<RotateCcw className="size-3.5" />} aria-label="Reset code" />
          <Button size="sm" onClick={run} loading={state.run.status === 'running'} icon={<Play className="size-3.5" />} title={`Run (${modKey}+Enter)`}>
            Run
          </Button>
          <Button size="sm" variant="primary" onClick={doSubmit} loading={submit.isPending} icon={<Send className="size-3.5" />} title={`Submit (${modKey}+Shift+Enter)`}>
            Submit
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {problem && dataset ? (
          <SqlEditor ref={editor} value={sql} onChange={setSql} dataset={dataset} onRun={run} onSubmit={doSubmit} onFormat={format} />
        ) : (
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
      </div>
      <div className="hidden h-7 shrink-0 items-center gap-3 border-t border-line px-3 text-[11px] text-faint md:flex">
        <span><Kbd>{modKey}</Kbd> <Kbd>↵</Kbd> run selection or all</span>
        <span><Kbd>{modKey}</Kbd> <Kbd>⇧</Kbd> <Kbd>↵</Kbd> submit</span>
        <span><Kbd>{modKey}</Kbd> <Kbd>K</Kbd> palette</span>
      </div>
    </div>
  );

  const consolePane = problem && (
    <ConsolePanel
      tab={tab}
      setTab={(t) => {
        setTab(t);
        if (t === 'plan' && state.run.sql && state.plan.status === 'idle') void explainNow(state.run.sql);
      }}
      state={state}
      problem={problem}
      dataset={dataset}
      onFixLine={(line) => {
        editor.current?.markErrorLine(line);
        editor.current?.focus();
        if (!desktop) setMobileView('code');
      }}
      onExplain={() => {}}
    />
  );

  const problemPane = problem ? (
    <ProblemPanel
      problem={problem}
      dataset={dataset}
      sql={sql}
      lastError={state.run.out && !state.run.out.ok ? state.run.out.error.message : undefined}
      onInsert={(s) => {
        editor.current?.insert(s);
        if (!desktop) setMobileView('code');
      }}
      onLoadSql={(s) => {
        setSql(s);
        if (!desktop) setMobileView('code');
        toast.info('Loaded into editor');
      }}
    />
  ) : (
    <div className="space-y-3 p-5">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-32" />
      <Skeleton className="h-48" />
    </div>
  );

  return (
    <div className="relative flex h-full flex-col">
      {problem && (
        <Seo
          title={`${problem.title} — ${problem.difficulty} SQL Problem | Querion`}
          description={`${problem.difficulty} PostgreSQL problem on ${problem.topics.join(', ')}. ${problem.statement.replace(/[`*#>]/g, '').slice(0, 120).trim()}…`}
          path={`/p/${problem.slug}`}
          jsonLd={{ '@type': 'LearningResource', name: problem.title, educationalLevel: problem.difficulty, learningResourceType: 'Exercise', teaches: problem.topics.join(', '), programmingLanguage: 'SQL', isAccessibleForFree: true, provider: { '@type': 'Organization', name: 'Querion' } }}
        />
      )}
      {header}
      {isLoading && !problem && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-bg/60">
          <OrbitLoader label="Loading problem…" />
        </div>
      )}
      {desktop ? (
        <PanelGroup direction="horizontal" autoSaveId="querion-studio-h" className="min-h-0 flex-1">
          <Panel defaultSize={40} minSize={24} className="bg-panel/40">
            <ErrorBoundary label="the problem panel">{problemPane}</ErrorBoundary>
          </Panel>
          <PanelResizeHandle className="resize-handle" />
          <Panel minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="querion-studio-v">
              <Panel defaultSize={58} minSize={20}>
                <ErrorBoundary label="the editor">{editorPane}</ErrorBoundary>
              </Panel>
              <PanelResizeHandle className="resize-handle" />
              <Panel minSize={14} className="bg-panel/40">
                <ErrorBoundary label="the console">{consolePane}</ErrorBoundary>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className={cx('h-full', mobileView !== 'problem' && 'hidden')}>{problemPane}</div>
            <div className={cx('h-full', mobileView !== 'code' && 'hidden')}>{editorPane}</div>
            <div className={cx('h-full', mobileView !== 'console' && 'hidden')}>{consolePane}</div>
          </div>
          <div className="grid h-14 shrink-0 grid-cols-3 border-t border-line bg-bg-2 pb-[env(safe-area-inset-bottom)]">
            {([['problem', 'Problem', FileText], ['code', 'Code', Database], ['console', 'Result', Terminal]] as const).map(([k, l, Icon]) => (
              <button key={k} onClick={() => setMobileView(k)} className={cx('flex flex-col items-center justify-center gap-0.5 text-[11px]', mobileView === k ? 'text-accent' : 'text-muted')}>
                <Icon className="size-4.5" />
                {l}
              </button>
            ))}
          </div>
        </>
      )}
      <Celebrate show={celebrate} />
    </div>
  );
}

/** Accepted! — a burst of stars from the centre, then fade. */
function Celebrate({ show }: { show: boolean }) {
  const stars = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ a: (i / 26) * Math.PI * 2, d: 120 + Math.random() * 160, s: 3 + Math.random() * 5, c: i % 3 === 0 ? 'var(--accent-2)' : i % 3 === 1 ? 'var(--accent)' : '#b9a7ff' })), []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} className="flex items-center gap-2 rounded-2xl border border-ok/40 bg-panel/90 px-5 py-3 text-lg font-semibold text-ok shadow-2xl backdrop-blur-xl">
            <Check className="size-5" /> Accepted
          </motion.div>
          {stars.map((s, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{ width: s.s, height: s.s, background: s.c, boxShadow: `0 0 10px ${s.c}` }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: Math.cos(s.a) * s.d, y: Math.sin(s.a) * s.d, opacity: 0, scale: 0.4 }}
              transition={{ duration: 1.3, ease: [0.2, 0.8, 0.2, 1] }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

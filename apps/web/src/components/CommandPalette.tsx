import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, BookOpen, CornerDownLeft, Flame, Gift, LayoutGrid, Orbit, Search, Sparkles, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { create } from 'zustand';
import { useMeta, useProblems } from '../lib/queries';
import { cx, DifficultyPill, Kbd, StatusDot, TierBadge } from './ui';

export const usePalette = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: ReactNode;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

/** Fuzzy-ish scoring: contiguous match > word-start match > subsequence. */
function score(q: string, text: string) {
  if (!q) return 1;
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) return 80 - i * 0.1 + (t[i - 1] === ' ' ? 10 : 0);
  let ti = 0;
  for (const ch of q) {
    ti = t.indexOf(ch, ti);
    if (ti < 0) return 0;
    ti++;
  }
  return 20;
}

export function CommandPalette() {
  const { open, setOpen } = usePalette();
  const nav = useNavigate();
  const { data: problems } = useProblems();
  const { data: meta } = useMeta();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!usePalette.getState().open);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const go = (path: string) => () => {
    nav(path);
    setOpen(false);
  };

  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      { id: 'nav-problems', group: 'Navigate', label: 'All problems', icon: <LayoutGrid className="size-4" />, run: go('/problems') },
      { id: 'nav-daily', group: 'Navigate', label: "Today's Daily Orbit", icon: <Flame className="size-4" />, keywords: 'daily challenge', run: go('/daily') },
      { id: 'nav-nebula', group: 'Navigate', label: 'Nebula — how problems are forged', icon: <Orbit className="size-4" />, keywords: 'pipeline ai kaggle insights', run: go('/nebula') },
      { id: 'nav-me', group: 'Navigate', label: 'My progress', icon: <User className="size-4" />, keywords: 'profile stats streak', run: go('/me') },
      { id: 'nav-invite', group: 'Navigate', label: 'Invite friends', icon: <Gift className="size-4" />, keywords: 'referral share', run: go('/me#invite') },
    ];
    for (const d of meta?.domains ?? []) {
      for (const k of d.datasets) base.push({ id: `track-${k}`, group: 'Tracks', label: `${d.label} track · ${k}`, icon: <BookOpen className="size-4" />, run: go(`/tracks/${k}`) });
    }
    for (const p of problems ?? []) {
      base.push({
        id: `p-${p.slug}`,
        group: 'Problems',
        label: p.title,
        keywords: `${p.topics.join(' ')} ${p.datasetName} ${p.difficulty}`,
        icon: <StatusDot status={p.status} />,
        hint: (
          <span className="flex items-center gap-1.5">
            <TierBadge tier={p.tier} />
            <DifficultyPill d={p.difficulty} />
          </span>
        ),
        run: go(`/p/${p.slug}`),
      });
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problems, meta]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items
      .map((it) => ({ it, s: Math.max(score(query, it.label), score(query, it.keywords ?? '') * 0.7) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, query ? 40 : 14)
      .map((x) => x.it);
  }, [q, items]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === 'Escape') setOpen(false);
  };

  let lastGroup = '';
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[3px]" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className="glass-strong relative w-full max-w-xl overflow-hidden rounded-2xl"
            role="dialog"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-faint" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="Search problems, tracks, actions…"
                className="h-13 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
                aria-label="Search"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted">
                  <Sparkles className="size-5 text-faint" />
                  No matches for “{q}”
                </div>
              )}
              {results.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <div key={it.id}>
                    {header && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{header}</div>}
                    <button
                      data-idx={i}
                      onMouseMove={() => setActive(i)}
                      onClick={it.run}
                      className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors', i === active ? 'bg-accent-soft text-ink' : 'text-muted')}
                    >
                      <span className="text-muted">{it.icon}</span>
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.hint}
                      {i === active && <CornerDownLeft className="size-3.5 text-accent" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="ml-auto flex items-center gap-1">
                <ArrowRight className="size-3" /> press <Kbd>?</Kbd> for all shortcuts
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

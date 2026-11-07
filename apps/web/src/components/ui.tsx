import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, CircleDot, Info, X, XCircle } from 'lucide-react';
import { create } from 'zustand';
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Difficulty } from '@querion/engine';

export const cx = clsx;

// ───────── Button ─────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const variants: Record<Variant, string> = {
  // the ONE place acid lime is allowed: the action we want pressed
  primary: 'bg-cta text-cta-ink font-semibold shadow-[0_0_0_1px_rgba(255,255,255,0.25)_inset,0_10px_30px_-12px_var(--glow)] hover:brightness-105',
  secondary: 'bg-panel-2 text-ink border border-line hover:border-line-strong hover:bg-panel',
  ghost: 'text-muted hover:text-ink hover:bg-panel-2',
  danger: 'bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25',
  success: 'bg-ok text-[#04140b] hover:brightness-105',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx(
          'relative inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
          size === 'sm' && 'h-8 px-3 text-[13px]',
          size === 'md' && 'h-9 px-4 text-sm',
          size === 'lg' && 'h-12 px-6 text-[15px]',
          variants[variant],
          className
        )}
        {...rest}
      >
        {loading ? <Spinner className="size-4" /> : icon}
        {children}
      </button>
    );
  }
);

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('animate-spin', className)} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Orbit loader — three stars circling, used for longer AI operations. */
export function OrbitLoader({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted">
      <div className="relative size-6">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 size-1.5 rounded-full bg-accent"
            style={{ marginLeft: -3, marginTop: -3 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2 + i * 0.35, repeat: Infinity, ease: 'linear' }}
          >
            <span className="absolute size-1.5 rounded-full" style={{ transform: `translateX(${7 + i * 3}px)`, background: i === 1 ? 'var(--accent-2)' : 'var(--accent)' }} />
          </motion.span>
        ))}
      </div>
      {label && <span className="animate-pulse">{label}</span>}
    </div>
  );
}

// ───────── Badges ─────────
export function DifficultyPill({ d, className }: { d: Difficulty; className?: string }) {
  const c = d === 'Easy' ? 'text-easy bg-easy/10 ring-easy/25' : d === 'Medium' ? 'text-medium bg-medium/10 ring-medium/25' : 'text-hard bg-hard/10 ring-hard/25';
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', c, className)}>{d}</span>;
}

const TIER_NAMES = ['', 'Foundations', 'Aggregation', 'Relationships', 'Composition', 'Analytics', 'Architect'];
export function TierBadge({ tier, showName = false }: { tier: number; showName?: boolean }) {
  return (
    <span
      title={`Tier ${tier} · ${TIER_NAMES[tier]}`}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold ring-1 ring-inset',
        tier === 6 ? 'bg-accent-soft text-accent ring-accent/30' : 'bg-panel-2 text-muted ring-line'
      )}
    >
      T{tier}
      {showName && <span className="font-sans font-medium">{TIER_NAMES[tier]}</span>}
    </span>
  );
}
export const tierName = (t: number) => TIER_NAMES[t];

export function Chip({ children, active, onClick, className }: { children: ReactNode; active?: boolean; onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all',
        active ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line text-muted hover:border-line-strong hover:text-ink',
        className
      )}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-panel-2 px-1.5 font-mono text-[10.5px] text-muted shadow-[0_1px_0_var(--border)]">{children}</kbd>;
}

export function StatusDot({ status }: { status: 'solved' | 'attempted' | null | string }) {
  if (status === 'solved') return <CheckCircle2 className="size-4 text-ok" aria-label="Solved" />;
  if (status === 'attempted') return <CircleDot className="size-4 text-warn" aria-label="Attempted" />;
  return <span className="inline-block size-4" aria-label="Not started" />;
}

// ───────── Skeleton & empty states ─────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-lg', className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-2xl border border-line bg-panel-2 text-muted">{icon}</div>
      <div className="font-medium">{title}</div>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

// ───────── Toasts ─────────
type Toast = { id: number; kind: 'success' | 'error' | 'info'; title: string; body?: string; action?: { label: string; onClick: () => void } };
const useToasts = create<{ items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), t.action ? 7000 : 4200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));
export const toast = {
  success: (title: string, body?: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'success', title, body, action }),
  error: (title: string, body?: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'error', title, body, action }),
  info: (title: string, body?: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'info', title, body, action }),
};

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(92vw,360px)] flex-col gap-2 max-md:bottom-20" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="glass-strong pointer-events-auto flex gap-3 rounded-2xl p-3.5"
          >
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-ok" /> : t.kind === 'error' ? <XCircle className="mt-0.5 size-4.5 shrink-0 text-bad" /> : <Info className="mt-0.5 size-4.5 shrink-0 text-accent" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[13px] text-muted">{t.body}</div>}
              {t.action && (
                <button className="mt-1.5 text-[13px] font-medium text-accent hover:underline" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-faint hover:text-ink" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ───────── Dialog & destructive confirmation ─────────
export function Dialog({ open, onClose, children, className, label }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; label: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            aria-label={label}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className={cx('glass-strong relative w-full max-w-md rounded-2xl p-6', className)}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const useConfirm = create<{ req: null | { title: string; body: string; confirm: string; typed?: string; resolve: (v: boolean) => void } }>(() => ({ req: null }));

/** Destructive-action protection: returns a promise; `typed` requires typing a word to confirm. */
export function confirmAction(opts: { title: string; body: string; confirm?: string; typed?: string }) {
  return new Promise<boolean>((resolve) => useConfirm.setState({ req: { confirm: 'Confirm', ...opts, resolve } }));
}

export function ConfirmHost() {
  const req = useConfirm((s) => s.req);
  const [text, setText] = useState('');
  const close = (v: boolean) => {
    req?.resolve(v);
    useConfirm.setState({ req: null });
    setText('');
  };
  return (
    <Dialog open={!!req} onClose={() => close(false)} label={req?.title ?? 'Confirm'}>
      {req && (
        <>
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-bad/12 text-bad">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <h2 className="font-semibold">{req.title}</h2>
              <p className="mt-1 text-sm text-muted">{req.body}</p>
            </div>
          </div>
          {req.typed && (
            <label className="mt-4 block text-sm text-muted">
              Type <span className="font-mono text-ink">{req.typed}</span> to confirm
              <input autoFocus value={text} onChange={(e) => setText(e.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-line bg-panel-2 px-3 font-mono text-ink outline-none focus:border-accent" />
            </label>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
            <Button variant="danger" disabled={!!req.typed && text !== req.typed} onClick={() => close(true)} autoFocus={!req.typed}>
              {req.confirm}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

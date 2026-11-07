import { useEffect, useRef, useState } from 'react';

/** Debounced value — used for autosave and search inputs. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Throttled callback — used for expensive actions (Run/Submit) so key-mashing can't flood the engine. */
export function useThrottle<A extends unknown[]>(fn: (...a: A) => void, ms = 800) {
  const last = useRef(0);
  const ref = useRef(fn);
  ref.current = fn;
  return (...args: A) => {
    const now = Date.now();
    if (now - last.current < ms) return;
    last.current = now;
    ref.current(...args);
  };
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';

/**
 * Keyboard shortcuts. Combo syntax: "mod+k", "mod+enter", "mod+shift+enter", "?", "g p".
 * Single-key shortcuts are ignored while typing in inputs/editors.
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, deps: unknown[] = []) {
  useEffect(() => {
    let seq = '';
    let seqTimer: number | undefined;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !!target.closest('.cm-editor');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      const combo = [mod && 'mod', e.shiftKey && 'shift', e.altKey && 'alt', key].filter(Boolean).join('+');
      if (map[combo] && (mod || e.altKey || !typing)) {
        e.preventDefault();
        map[combo](e);
        return;
      }
      if (typing || mod) return;
      seq = seq ? `${seq} ${key}` : key;
      window.clearTimeout(seqTimer);
      seqTimer = window.setTimeout(() => (seq = ''), 700);
      if (map[seq]) {
        e.preventDefault();
        map[seq](e);
        seq = '';
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function timeAgo(iso: string | number) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

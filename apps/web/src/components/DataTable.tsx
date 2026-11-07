import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cx } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sort?: (row: T) => string | number;
  className?: string;
  /** Hide below this breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg';
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  empty?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}

const hide = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden' };

/** Reusable table: sortable columns, row selection (for bulk actions), keyboard-accessible rows. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, selectable, selected, onSelectedChange, empty, initialSort }: Props<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const s = [...rows].sort((a, b) => {
      const x = col.sort!(a);
      const y = col.sort!(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return sort.dir === 'desc' ? s.reverse() : s;
  }, [rows, sort, columns]);

  const allKeys = sorted.map(rowKey);
  const allSelected = selectable && allKeys.length > 0 && allKeys.every((k) => selected?.has(k));
  const toggleAll = () => onSelectedChange?.(allSelected ? new Set() : new Set(allKeys));
  const toggle = (k: string) => {
    const s = new Set(selected);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    onSelectedChange?.(s);
  };

  if (!rows.length) return <>{empty}</>;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-faint">
            {selectable && (
              <th className="w-10 pl-4">
                <input type="checkbox" checked={!!allSelected} onChange={toggleAll} aria-label="Select all" className="size-3.5 accent-[var(--accent)]" />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} className={cx('px-4 py-3 font-medium', c.hideBelow && hide[c.hideBelow], c.className)}>
                {c.sort ? (
                  <button
                    className="inline-flex items-center gap-1 hover:text-ink"
                    onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                  >
                    {c.header}
                    {sort?.key === c.key ? sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const k = rowKey(r);
            const sel = selected?.has(k);
            return (
              <tr
                key={k}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => onRowClick?.(r)}
                onKeyDown={(e) => e.key === 'Enter' && onRowClick?.(r)}
                className={cx('group border-b border-line/60 transition-colors last:border-0', onRowClick && 'cursor-pointer hover:bg-panel-2', sel && 'bg-accent-soft')}
              >
                {selectable && (
                  <td className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={!!sel} onChange={() => toggle(k)} aria-label="Select row" className="size-3.5 accent-[var(--accent)]" />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-4 py-3', c.hideBelow && hide[c.hideBelow], c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

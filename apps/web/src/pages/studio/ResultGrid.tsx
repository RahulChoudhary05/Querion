import { Copy, Download } from 'lucide-react';
import { normalizeCell, type ResultSet } from '@querion/engine';
import { cx, toast } from '../../components/ui';

const TYPE: Record<number, string> = { 20: 'int8', 21: 'int2', 23: 'int4', 700: 'float4', 701: 'float8', 1700: 'numeric', 25: 'text', 1043: 'varchar', 1082: 'date', 1114: 'timestamp', 1184: 'timestamptz', 16: 'bool' };

function display(v: unknown, typeId: number) {
  if (v === null || v === undefined) return <span className="italic text-faint">NULL</span>;
  if (v instanceof Date) return normalizeCell(v, typeId);
  if (typeof v === 'boolean') return <span className={v ? 'text-ok' : 'text-bad'}>{String(v)}</span>;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const isNum = (id: number) => [20, 21, 23, 700, 701, 1700].includes(id);

export function toCsv(rs: ResultSet) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [rs.fields.map((f) => esc(f.name)).join(','), ...rs.rows.map((r) => r.map((v, i) => (v === null ? '' : esc(normalizeCell(v, rs.fields[i].dataTypeID)))).join(','))].join('\n');
}

/** Spreadsheet-like result viewer with sticky headers, column types, row numbers, copy/download. */
export function ResultGrid({ rs, highlightRows, compact, toolbar = true }: { rs: ResultSet; highlightRows?: Set<number>; compact?: boolean; toolbar?: boolean }) {
  const copy = async () => {
    await navigator.clipboard.writeText(toCsv(rs).replace(/,/g, '\t'));
    toast.success('Copied as TSV', 'Paste straight into a spreadsheet.');
  };
  const download = () => {
    const blob = new Blob([toCsv(rs)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'querion-result.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar && (
        <div className="flex items-center justify-end gap-1 px-2 pb-1">
          <button onClick={copy} className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted hover:bg-panel-2 hover:text-ink">
            <Copy className="size-3.5" /> Copy
          </button>
          <button onClick={download} className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted hover:bg-panel-2 hover:text-ink">
            <Download className="size-3.5" /> CSV
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line">
        <table className={cx('w-max min-w-full border-collapse font-mono', compact ? 'text-[11.5px]' : 'text-[12.5px]')}>
          <thead className="sticky top-0 z-10 bg-panel-2">
            <tr>
              <th className="w-10 border-b border-line px-2 py-1.5 text-right text-[10.5px] font-normal text-faint">#</th>
              {rs.fields.map((f, i) => (
                <th key={i} className="border-b border-l border-line px-3 py-1.5 text-left font-sans">
                  <div className="text-[12px] font-semibold text-ink">{f.name}</div>
                  <div className="text-[10px] font-normal text-faint">{TYPE[f.dataTypeID] ?? `oid ${f.dataTypeID}`}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rs.rows.map((r, ri) => (
              <tr key={ri} className={cx('hover:bg-panel-2/70', highlightRows?.has(ri) && 'bg-bad/10')}>
                <td className="border-b border-line/50 px-2 py-1 text-right text-[10.5px] text-faint">{ri + 1}</td>
                {r.map((v, ci) => (
                  <td key={ci} className={cx('max-w-[320px] truncate border-b border-l border-line/50 px-3 py-1', isNum(rs.fields[ci]?.dataTypeID) && 'text-right tabular-nums')}>
                    {display(v, rs.fields[ci]?.dataTypeID)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

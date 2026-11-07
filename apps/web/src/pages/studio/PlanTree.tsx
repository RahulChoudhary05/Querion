import type { PlanNode } from '@querion/engine';
import { cx } from '../../components/ui';

/** EXPLAIN ANALYZE as a readable tree, with relative-cost bars so hotspots jump out. */
export function PlanTree({ plan, executionMs }: { plan: PlanNode; executionMs?: number }) {
  const root = plan['Total Cost'] || 1;
  const Row = ({ n, depth }: { n: PlanNode; depth: number }) => {
    const self = Math.max(0, n['Total Cost'] - (n.Plans ?? []).reduce((s, c) => s + c['Total Cost'], 0));
    const pct = Math.min(100, (self / root) * 100);
    const detail = [n['Relation Name'] && `on ${n['Relation Name']}`, n['Join Type'] && `${n['Join Type']} join`, n['Hash Cond'] && `cond ${n['Hash Cond']}`, n.Filter && `filter ${n.Filter}`, n['Sort Key'] && `by ${n['Sort Key'].join(', ')}`, n['Group Key'] && `group ${n['Group Key'].join(', ')}`]
      .filter(Boolean)
      .join(' · ');
    const hot = pct > 40;
    return (
      <>
        <div className="group grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-panel-2" style={{ paddingLeft: 8 + depth * 18 }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px]">
              {depth > 0 && <span className="text-faint">↳</span>}
              <span className={cx('font-medium', hot && 'text-warn')}>{n['Node Type']}</span>
              {n['Actual Rows'] !== undefined && <span className="font-mono text-[11px] text-faint">{n['Actual Rows']} rows</span>}
            </div>
            {detail && <div className="truncate pl-5 font-mono text-[11px] text-muted">{detail}</div>}
          </div>
          <div className="flex w-40 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
              <div className={cx('h-full rounded-full', hot ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.max(2, pct)}%` }} />
            </div>
            <span className="w-14 text-right font-mono text-[11px] text-muted">{n['Total Cost'].toFixed(1)}</span>
          </div>
        </div>
        {(n.Plans ?? []).map((c, i) => (
          <Row key={i} n={c} depth={depth + 1} />
        ))}
      </>
    );
  };
  return (
    <div>
      <div className="mb-2 flex gap-4 px-2 text-xs text-muted">
        <span>
          Total cost <b className="font-mono text-ink">{plan['Total Cost'].toFixed(2)}</b>
        </span>
        {executionMs !== undefined && (
          <span>
            Execution <b className="font-mono text-ink">{executionMs.toFixed(2)} ms</b>
          </span>
        )}
        <span className="ml-auto text-faint">Bars show each node's own share of the cost</span>
      </div>
      <Row n={plan} depth={0} />
    </div>
  );
}

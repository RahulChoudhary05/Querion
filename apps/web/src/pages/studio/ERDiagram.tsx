import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { KeyRound, Link2 } from 'lucide-react';
import { useMemo } from 'react';
import type { Dataset, TableDef } from '@querion/engine';

type TableNode = Node<{ table: TableDef; onPick?: (s: string) => void }, 'table'>;

function TableCard({ data }: NodeProps<TableNode>) {
  const t = data.table;
  return (
    <div className="w-[230px] overflow-hidden rounded-xl border border-line-strong bg-panel shadow-xl">
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-accent" />
      <button onClick={() => data.onPick?.(t.name)} className="flex w-full items-center justify-between bg-panel-2 px-3 py-2 text-left">
        <span className="font-mono text-[12.5px] font-semibold text-accent">{t.name}</span>
        <span className="font-mono text-[10px] text-faint">{t.rows.length} rows</span>
      </button>
      <div className="py-1">
        {t.columns.map((c) => (
          <button key={c.name} onClick={() => data.onPick?.(c.name)} title={c.note ?? c.type} className="flex w-full items-center gap-2 px-3 py-[3px] text-left font-mono text-[11px] hover:bg-accent-soft">
            {c.pk ? <KeyRound className="size-3 text-warn" /> : c.ref ? <Link2 className="size-3 text-accent-2" /> : <span className="size-3" />}
            <span className="truncate text-ink">{c.name}</span>
            <span className="ml-auto text-faint">{c.type.replace(/\(.*\)/, '')}</span>
          </button>
        ))}
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-accent-2" />
    </div>
  );
}

const nodeTypes = { table: TableCard };

/** Interactive ER diagram: dimension tables on the left, facts flowing right. Click names to insert them. */
export function ERDiagram({ dataset, onPick }: { dataset: Dataset; onPick?: (s: string) => void }) {
  const { nodes, edges } = useMemo(() => {
    const byName = new Map(dataset.tables.map((t) => [t.name, t]));
    const depth = new Map<string, number>();
    const visit = (name: string, stack: Set<string>): number => {
      if (depth.has(name)) return depth.get(name)!;
      if (stack.has(name)) return 0;
      stack.add(name);
      const t = byName.get(name);
      const parents = [...new Set((t?.columns ?? []).map((c) => c.ref?.split('.')[0]).filter((p): p is string => !!p && p !== name && byName.has(p)))];
      const d = parents.length ? 1 + Math.max(...parents.map((p) => visit(p, stack))) : 0;
      depth.set(name, d);
      return d;
    };
    dataset.tables.forEach((t) => visit(t.name, new Set()));
    const cols = new Map<number, number>();
    const nodes: TableNode[] = dataset.tables.map((t) => {
      const d = depth.get(t.name) ?? 0;
      const row = cols.get(d) ?? 0;
      cols.set(d, row + 1);
      return { id: t.name, type: 'table', position: { x: d * 300, y: row * (60 + Math.min(t.columns.length, 12) * 19) + (d % 2) * 30 }, data: { table: t, onPick } };
    });
    // stack rows correctly using cumulative heights
    const heights = new Map<number, number>();
    for (const n of nodes) {
      const d = depth.get(n.id) ?? 0;
      const y = heights.get(d) ?? 0;
      n.position.y = y;
      heights.set(d, y + 54 + n.data.table.columns.length * 20 + 28);
    }
    const edges: Edge[] = [];
    for (const t of dataset.tables)
      for (const c of t.columns)
        if (c.ref) {
          const [target] = c.ref.split('.');
          if (byName.has(target))
            edges.push({ id: `${t.name}.${c.name}`, source: target, target: t.name, animated: true, label: c.name, style: { stroke: 'var(--accent)', strokeOpacity: 0.6 }, labelStyle: { fill: 'var(--muted)', fontSize: 10, fontFamily: 'JetBrains Mono' }, labelBgStyle: { fill: 'var(--panel)' } });
        }
    return { nodes, edges };
  }, [dataset, onPick]);

  return (
    <div className="h-full min-h-[360px] w-full">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.3} proOptions={{ hideAttribution: true }} nodesConnectable={false}>
        <Background color="var(--border)" gap={22} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

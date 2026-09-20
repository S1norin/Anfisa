/**
 * processDiagram (t12): lightweight HTML/CSS flow diagram for the How It
 * Works view. No WebGL — plain boxes and arrows, matching the tutorial's
 * physical → digital split.
 */

interface FlowNode {
  id: string;
  label: string;
  sub?: string;
}

const PHYSICAL: FlowNode[] = [
  { id: 'belt', label: 'Conveyor', sub: 'belt + encoder (mm)' },
  { id: 'photoeyes', label: 'Photo-eyes', sub: 'entry / exit' },
  { id: 'trigger', label: 'Reader triggering', sub: 'encoder position + timing' },
];

const CAPTURE: FlowNode[] = [
  { id: 'area', label: 'Area readers', sub: '4 oblique, 25 fps' },
  { id: 'line', label: 'Line scanners', sub: 'top + bottom, encoder-synced' },
];

const DIGITAL: FlowNode[] = [
  { id: 'quality', label: 'Quality gating', sub: 'ppm · exposure · incidence' },
  { id: 'decode', label: 'Analytic decode', sub: 'geometric projection' },
  { id: 'association', label: 'Association', sub: 'interval overlap' },
  { id: 'aggregate', label: 'Dedup / aggregate', sub: 'per-label union' },
  { id: 'output', label: 'PLC ACK / sort', sub: 'final result' },
];

function Node({ node, active }: { node: FlowNode; active: boolean }) {
  return (
    <div
      className={active ? 'flow-node flow-node-active' : 'flow-node'}
      data-testid={`flow-${node.id}`}
    >
      <div className="flow-node-label">{node.label}</div>
      {node.sub && <div className="flow-node-sub">{node.sub}</div>}
    </div>
  );
}

function Row({
  nodes,
  activeId,
  label,
}: {
  nodes: FlowNode[];
  activeId?: string;
  label: string;
}) {
  return (
    <div className="flow-row" data-testid={`flow-row-${label}`}>
      {nodes.map((n, i) => (
        <div key={n.id} className="flow-cell">
          {i > 0 && <span className="flow-arrow" aria-hidden>
            →
          </span>}
          <Node node={n} active={n.id === activeId} />
        </div>
      ))}
    </div>
  );
}

/**
 * Maps the 11 guide stage ids onto diagram node ids so the active step
 * highlights the matching part of the diagram.
 */
const STAGE_TO_NODE: Record<string, string> = {
  created: 'belt',
  'entry-tracking': 'photoeyes',
  'reader-triggering': 'trigger',
  acquisition: 'area',
  preprocessing: 'line',
  'quality-gating': 'quality',
  decode: 'decode',
  association: 'association',
  'dedup-aggregation': 'aggregate',
  'exit-finalization': 'photoeyes',
  'plc-ack-sort': 'output',
};

export function ProcessDiagram({ activeStageId }: { activeStageId?: string }) {
  const active = activeStageId ? STAGE_TO_NODE[activeStageId] : undefined;
  return (
    <div className="process-diagram" data-testid="process-diagram">
      <Row nodes={PHYSICAL} activeId={active} label="physical" />
      <Row nodes={CAPTURE} activeId={active} label="capture" />
      <Row nodes={DIGITAL} activeId={active} label="digital" />
    </div>
  );
}

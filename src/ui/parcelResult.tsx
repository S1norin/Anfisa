/**
 * Parcel result card (t11): expected labels, observations, unique
 * instances, payloads, status, and latency for the selected parcel.
 *
 * Before finalize: a "pending" card with the spec summary and current
 * phase. After finalize: the full PIPE-009 result — including per-label
 * reason codes, so every no-read is explainable (phase AC).
 */

import type {
  FinalizedParcel,
  ParcelResult,
  ParcelState,
} from '../domain/types';
import { exitToAckMs } from '../domain/events';

interface Props {
  parcel: ParcelState | undefined;
  retired: FinalizedParcel | undefined;
  result: ParcelResult | undefined;
}

function fmtMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

/** Payload list with duplicate counts: A×2 B. */
function fmtPayloads(payloads: string[]): string {
  const counts = new Map<string, number>();
  for (const p of payloads) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()]
    .map(([p, n]) => (n > 1 ? `${p} ×${n}` : p))
    .join('  ');
}

export function ParcelResultCard({ parcel, retired, result }: Props) {
  const parcelId = parcel?.parcelId ?? retired?.parcelId;
  const spec = parcel?.spec ?? retired?.spec;

  if (!parcelId || !spec) {
    return (
      <section className="op-card" data-testid="parcel-result">
        <h3>Parcel result</h3>
        <p className="op-card-empty">No parcel selected.</p>
      </section>
    );
  }

  if (!result) {
    const phase = parcel?.phase ?? 'FINALIZING';
    return (
      <section className="op-card" data-testid="parcel-result">
        <h3>
          Parcel result <span className="op-card-id">{parcelId}</span>
        </h3>
        <dl className="result-dl">
          <div>
            <dt>Phase</dt>
            <dd data-testid="result-phase">{phase}</dd>
          </div>
          <div>
            <dt>Size (W×H×L)</dt>
            <dd>
              {spec.widthMm}×{spec.heightMm}×{spec.lengthMm} mm
            </dd>
          </div>
          <div>
            <dt>Material</dt>
            <dd>{spec.material}</dd>
          </div>
          <div>
            <dt>Expected labels</dt>
            <dd data-testid="result-expected">{spec.labels.length}</dd>
          </div>
        </dl>
        <p className="result-pending" data-testid="result-pending">
          Awaits exit + finalize grace.
        </p>
      </section>
    );
  }

  const observed = result.labelResults.filter((l) => l.observationCount > 0);
  const ackMs = exitToAckMs(result);

  return (
    <section className="op-card" data-testid="parcel-result">
      <h3>
        Parcel result <span className="op-card-id">{parcelId}</span>{' '}
        <span
          className={`status-badge status-${result.status}`}
          data-testid="result-status"
        >
          {result.status}
        </span>
      </h3>
      <dl className="result-dl">
        <div>
          <dt>Expected / decoded</dt>
          <dd data-testid="result-decoded">
            {result.decodedLabels} / {result.expectedLabels}
          </dd>
        </div>
        <div>
          <dt>Unique instances observed</dt>
          <dd data-testid="result-instances">{observed.length}</dd>
        </div>
        <div>
          <dt>Payloads</dt>
          <dd data-testid="result-payloads" title={fmtPayloads(result.payloads)}>
            {result.payloads.length === 0 ? '—' : fmtPayloads(result.payloads)}
          </dd>
        </div>
        <div>
          <dt>Entry → result</dt>
          <dd>{fmtMs(result.entryToResultMs)}</dd>
        </div>
        <div>
          <dt>Exit → result</dt>
          <dd>{fmtMs(result.exitToResultMs)}</dd>
        </div>
        <div>
          <dt>Exit → ACK</dt>
          <dd data-testid="result-ack-latency">
            {ackMs === undefined ? '—' : fmtMs(ackMs)}
          </dd>
        </div>
      </dl>
      <table className="result-labels" data-testid="result-labels">
        <thead>
          <tr>
            <th>Face</th>
            <th>Instance</th>
            <th>Obs</th>
            <th>Decoded</th>
            <th>Reasons</th>
          </tr>
        </thead>
        <tbody>
          {result.labelResults.map((lr) => (
            <tr key={lr.labelInstanceId} data-testid={`result-label-${lr.labelInstanceId}`}>
              <td>{lr.face}</td>
              <td title={lr.payload}>{lr.payload.length > 8 ? `${lr.payload.slice(0, 8)}…` : lr.payload}</td>
              <td>{lr.observationCount}</td>
              <td>{lr.decoded ? '✓' : '—'}</td>
              <td className="result-reasons">
                {lr.decoded ? '' : lr.reasons.join(', ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

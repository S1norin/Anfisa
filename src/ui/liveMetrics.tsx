/**
 * Live metrics panel (t11, MET-001..MET-006): computed on every sim tick
 * over everything processed so far (same pure computation as the run
 * record, see SimStore.computeLiveMetrics).
 *
 * Shows: evaluated/spawned counts, complete-read rate, recall, precision,
 * no-read parcels, false decodes, misassociations, observations,
 * duplicate rate, dropped frames (buffer-bound trims), and separate
 * entry→result / exit→result latency blocks.
 */

import type { RunMetrics } from '../metrics/metrics';

interface Props {
  metrics: RunMetrics;
  /** Parcels spawned so far this run. */
  spawned: number;
  /** Finalized results with status NO_READ. */
  noReads: number;
  /** Captures trimmed away by the bounded per-camera frame buffers. */
  droppedFrames: number;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function LiveMetrics({ metrics, spawned, noReads, droppedFrames }: Props) {
  const { latency } = metrics;
  return (
    <section className="op-card" data-testid="live-metrics">
      <h3>Live metrics</h3>
      <dl className="metrics-dl">
        <div>
          <dt>Evaluated / spawned</dt>
          <dd data-testid="metrics-evaluated">
            {metrics.evaluatedParcels} / {spawned}
          </dd>
        </div>
        <div>
          <dt>Complete read</dt>
          <dd data-testid="metrics-complete-read">{pct(metrics.completeReadRate)}</dd>
        </div>
        <div>
          <dt>Recall</dt>
          <dd data-testid="metrics-recall">{pct(metrics.barcodeRecall)}</dd>
        </div>
        <div>
          <dt>Precision</dt>
          <dd data-testid="metrics-precision">{pct(metrics.barcodePrecision)}</dd>
        </div>
        <div>
          <dt>No-read parcels</dt>
          <dd data-testid="metrics-no-reads">{noReads}</dd>
        </div>
        <div>
          <dt>False decodes</dt>
          <dd data-testid="metrics-false-decodes">{metrics.falseDecodes}</dd>
        </div>
        <div>
          <dt>Misassociations</dt>
          <dd data-testid="metrics-misassociations">{metrics.misassociations}</dd>
        </div>
        <div>
          <dt>Observations</dt>
          <dd data-testid="metrics-observations">{metrics.totalObservations}</dd>
        </div>
        <div>
          <dt>Duplicate rate</dt>
          <dd data-testid="metrics-duplicate-rate">{pct(metrics.duplicateRate)}</dd>
        </div>
        <div>
          <dt>Dropped frames</dt>
          <dd data-testid="metrics-dropped-frames">{droppedFrames}</dd>
        </div>
        <div>
          <dt>Entry → result P50 / P95</dt>
          <dd data-testid="metrics-entry-result-p95">
            {Math.round(latency.entryToResultMs.p50)} / {Math.round(latency.entryToResultMs.p95)} ms
          </dd>
        </div>
        <div>
          <dt>Exit → result P50 / P95</dt>
          <dd data-testid="metrics-exit-result-p95">
            {Math.round(latency.exitToResultMs.p50)} / {Math.round(latency.exitToResultMs.p95)} ms
          </dd>
        </div>
        <div>
          <dt>Exit → ACK P95</dt>
          <dd data-testid="metrics-exit-ack-p95">
            {Math.round(latency.exitToAckMs.p95)} ms
          </dd>
        </div>
      </dl>
    </section>
  );
}

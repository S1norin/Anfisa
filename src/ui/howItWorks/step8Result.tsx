/**
 * Step 8: combine, deduplicate, final result (t6-2).
 *
 * The parcel leaves the box and reaches the output point. Repeated reads
 * of the same physical label instance collapse into one entry (keyed by
 * instance, never by payload); distinct labels stay distinct. The compact
 * result card lists the unique barcode values with their source sensors
 * and the merged read count; failed reads show their explicit reasons and
 * never a value; technical values sit behind a details control.
 *
 * Everything is computed with the EXISTING pipeline rules — aggregation.ts
 * (addObservation / newAggregate) and finalize.ts (decideStatus). The
 * input is exactly the accepted pixel-decoded observations from step 7
 * (observationRowsAt).
 *
 * Display path only — no new association/aggregation logic, the analytic
 * live simulation is untouched.
 */

import type { DecodeResult } from '../../pipeline/decoder';
import {
  addObservation,
  newAggregate,
  type AggregatedLabel,
} from '../../pipeline/aggregation';
import { decideStatus } from '../../pipeline/finalize';
import type { ParcelResultStatus } from '../../domain/types';
import type { ReplayManifest } from './replayManifest';
import { stepIndexAt } from './playbackStore';
import { observationRowsAt } from './step7Association';

/** Story finalize moment: the end of the 60 s guided replay. */
export const STORY_FINALIZE_MS = 60_000;

export interface Step8Result {
  parcelId: string;
  status: ParcelResultStatus;
  /** Unique label instances (deduped by physical instance). */
  labels: AggregatedLabel[];
  /** Unique decoded payloads (insertion order). */
  payloads: string[];
  expectedLabels: number;
  decodedLabels: number;
  /** Total observations folded in (= step-7 rows). */
  observationCount: number;
  finalizedSimTimeMs: number;
}

/** DecodeResult view of a manifest observation (confidence: 1 when decoded). */
function decodeResultOf(obs: {
  labelInstanceId: string;
  decoded: boolean;
  decodedPayload?: string;
  reasons: string[];
}): DecodeResult {
  return {
    labelInstanceId: obs.labelInstanceId,
    decoded: obs.decoded,
    decodedPayload: obs.decodedPayload,
    confidence: obs.decoded ? 1 : 0,
    reasons: obs.reasons,
  };
}

/**
 * Fold every step-7 row (accepted, pixel-decoded observations) through the
 * production aggregation + status policy. Failed decodes are folded too —
 * they carry reasons and source cameras, they just never yield a value.
 */
export function buildStep8Result(manifest: ReplayManifest): Step8Result {
  const agg = newAggregate(manifest.parcel.parcelId);
  const rows = observationRowsAt(manifest);
  for (const { observation: obs, capture, association } of rows) {
    const spec = manifest.parcel.labels.find(
      (l) => l.labelInstanceId === obs.labelInstanceId,
    );
    addObservation(agg, {
      parcelId: obs.parcelId,
      labelInstanceId: obs.labelInstanceId,
      face: spec?.face ?? 'FRONT',
      payload: spec?.payload ?? '',
      confidence: obs.decoded ? 1 : 0,
      reasons: obs.reasons,
      cameraId: capture.sensorId,
      simTimeMs: capture.simTimeMs,
      decode: decodeResultOf(obs),
      association,
    });
  }
  const decoded = agg.labels.filter((l) => l.decoded);
  const payloads: string[] = [];
  for (const p of decoded.map((l) => l.decodedPayload)) {
    if (p && !payloads.includes(p)) payloads.push(p);
  }
  const status = decideStatus({
    aggregate: agg,
    expectedLabels: manifest.parcel.labels.length,
    totalObservations: rows.length,
    faultedObservations: 0,
  });
  return {
    parcelId: manifest.parcel.parcelId,
    status,
    labels: agg.labels,
    payloads,
    expectedLabels: manifest.parcel.labels.length,
    decodedLabels: decoded.length,
    observationCount: rows.length,
    finalizedSimTimeMs: STORY_FINALIZE_MS,
  };
}

/** One card value row: a unique payload merged across its source sensors. */
export interface Step8ValueRow {
  payload: string;
  /** Source sensors, first-seen order. */
  sensors: string[];
  /** Merged read count (duplicates of the same instance collapse here). */
  readCount: number;
  /** Label instances contributing this payload. */
  instances: string[];
}

export function valueRowsOf(result: Step8Result): Step8ValueRow[] {
  const rows: Step8ValueRow[] = [];
  for (const label of result.labels) {
    if (!label.decoded || !label.decodedPayload) continue;
    const row = rows.find((r) => r.payload === label.decodedPayload);
    if (row) {
      for (const s of label.cameras) {
        if (!row.sensors.includes(s)) row.sensors.push(s);
      }
      row.readCount += label.decodedCount;
      row.instances.push(label.labelInstanceId);
    } else {
      rows.push({
        payload: label.decodedPayload,
        sensors: [...label.cameras],
        readCount: label.decodedCount,
        instances: [label.labelInstanceId],
      });
    }
  }
  return rows;
}

/** Human-readable status line. */
export function statusTextOf(result: Step8Result): string {
  const n = `${result.decodedLabels}/${result.expectedLabels}`;
  switch (result.status) {
    case 'OK':
      return `OK — ${n} labels read`;
    case 'PARTIAL':
      return `PARTIAL — ${n} labels read`;
    case 'NO_READ':
      return `NO_READ — ${n} labels read`;
    case 'AMBIGUOUS':
      return 'AMBIGUOUS — association mismatch';
    case 'SENSOR_FAULT':
      return 'SENSOR_FAULT';
  }
}

export function Step8Result({
  manifest,
  timeMs,
}: {
  manifest: ReplayManifest;
  timeMs: number;
}) {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, timeMs);
  if (manifest.steps[idx].step !== 8) {
    return (
      <div className="step8-empty" data-testid="step8-empty">
        The result card is built when the parcel reaches the output point —
        reads of the same physical label collapse into one value.
      </div>
    );
  }
  const result = buildStep8Result(manifest);
  const valueRows = valueRowsOf(result);
  const notDecoded = result.labels.filter((l) => !l.decoded);
  return (
    <div className="step8-result" data-testid="step8-result" data-status={result.status}>
      <div className="step8-statusline">
        <span data-testid="step8-status">{statusTextOf(result)}</span>
        <span data-testid="step8-timestamp">
          t {(result.finalizedSimTimeMs / 1000).toFixed(1)} s
        </span>
      </div>
      <div className="step8-values" data-testid="step8-values">
        {valueRows.map((row) => (
          <div
            key={row.payload}
            className="step8-value-row"
            data-testid={`step8-value-${row.payload}`}
          >
            <span className="step8-payload" data-testid="step8-value-text">
              {row.payload}
            </span>
            <span data-testid="step8-value-sensors">{row.sensors.join(', ')}</span>
            <span
              data-testid="step8-value-merged"
              data-count={row.readCount}
            >
              {row.readCount} {row.readCount === 1 ? 'read' : 'reads'}
              {row.readCount > 1 ? ' merged' : ''}
            </span>
          </div>
        ))}
        {notDecoded.map((label) => (
          <div
            key={label.labelInstanceId}
            className="step8-value-row step8-value-failed"
            data-testid={`step8-label-${label.labelInstanceId}`}
            data-decoded="false"
          >
            <span data-testid="step8-noread" className="step8-noread">
              no read: {label.reasons.join(', ')}
            </span>
            <span data-testid="step8-label-sensors">
              {label.cameras.join(', ')}
            </span>
            <span data-testid="step8-label-merged" data-count={label.observationCount}>
              {label.observationCount}{' '}
              {label.observationCount === 1 ? 'read' : 'reads'}
              {label.observationCount > 1 ? ' merged' : ''}
            </span>
          </div>
        ))}
      </div>
      <details className="step8-details" data-testid="step8-details">
        <summary>technical</summary>
        <div className="step8-tech" data-testid="step8-tech">
          <div>
            parcel {result.parcelId} · {result.observationCount} observations ·{' '}
            {result.decodedLabels}/{result.expectedLabels} labels decoded
          </div>
          {result.labels.map((label) => (
            <div key={label.labelInstanceId} data-testid={`step8-tech-${label.labelInstanceId}`}>
              {label.labelInstanceId} ({label.face}) ·{' '}
              {label.decodedCount}/{label.observationCount} decoded · conf{' '}
              {label.bestConfidence.toFixed(2)} · t{' '}
              {(label.firstObsMs / 1000).toFixed(1)}–
              {(label.lastObsMs / 1000).toFixed(1)} s · {label.reasons.join(', ') || 'clean'}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * Finalization + status policy (PIPE-009).
 *
 * A parcel is ready to finalize after its exit event plus the configured
 * grace period. Status policy (first match wins):
 *
 *   AMBIGUOUS    — any association mismatch (ghost / unknown / stale)
 *   SENSOR_FAULT — observations existed but ALL carried CAMERA_FAULT
 *   OK           — every expected label instance decoded
 *   PARTIAL      — at least one, not all
 *   NO_READ      — none decoded (clean obs existed, all failed quality)
 */

import type {
  LabelResult,
  ParcelResult,
  ParcelResultStatus,
  ParcelState,
} from '../domain/types';
import type { ParcelAggregate } from './aggregation';

export interface FinalizeInput {
  parcel: ParcelState;
  aggregate: ParcelAggregate;
  simTimeMs: number;
  finalizeGraceMs: number;
  /** Total observations attributed to the parcel this run. */
  totalObservations: number;
  /** Observations carrying CAMERA_FAULT. */
  faultedObservations: number;
}

export function parcelReadyToFinalize(
  parcel: ParcelState,
  simTimeMs: number,
  finalizeGraceMs: number,
): boolean {
  return (
    parcel.exitSimTimeMs !== undefined &&
    simTimeMs - parcel.exitSimTimeMs >= finalizeGraceMs
  );
}

export function decideStatus(input: {
  aggregate: ParcelAggregate;
  expectedLabels: number;
  totalObservations: number;
  faultedObservations: number;
}): ParcelResultStatus {
  const { aggregate, expectedLabels, totalObservations, faultedObservations } =
    input;

  if (aggregate.mismatches.length > 0) return 'AMBIGUOUS';
  if (
    totalObservations > 0 &&
    faultedObservations === totalObservations
  ) {
    return 'SENSOR_FAULT';
  }
  const decoded = aggregate.labels.filter((l) => l.decoded).length;
  if (expectedLabels === 0) return 'OK';
  if (decoded === expectedLabels) return 'OK';
  if (decoded > 0) return 'PARTIAL';
  return 'NO_READ';
}

export function finalizeParcel(input: FinalizeInput): ParcelResult {
  const { parcel, aggregate, simTimeMs } = input;

  const labelResults: LabelResult[] = aggregate.labels.map((l) => ({
    labelInstanceId: l.labelInstanceId,
    face: l.face,
    payload: l.payload,
    decodedPayload: l.decodedPayload,
    decoded: l.decoded,
    bestConfidence: l.bestConfidence,
    observationCount: l.observationCount,
    decodedCount: l.decodedCount,
    cameras: l.cameras,
    reasons: l.reasons,
  }));

  // Include expected instances that were never observed so the audit record
  // shows what the parcel carried vs what was read.
  const seen = new Set(labelResults.map((l) => l.labelInstanceId));
  for (const spec of parcel.spec.labels) {
    if (!seen.has(spec.labelInstanceId)) {
      labelResults.push({
        labelInstanceId: spec.labelInstanceId,
        face: spec.face,
        payload: spec.payload,
        decoded: false,
        bestConfidence: 0,
        observationCount: 0,
        decodedCount: 0,
        cameras: [],
        reasons: ['NO_OBSERVATION'],
      });
    }
  }
  labelResults.sort((a, b) =>
    a.labelInstanceId.localeCompare(b.labelInstanceId, undefined, {
      numeric: true,
    }),
  );

  const decodedLabels = labelResults.filter((l) => l.decoded);
  const payloads = decodedLabels.map((l) => l.decodedPayload!);
  const status = decideStatus({
    aggregate,
    expectedLabels: parcel.spec.labels.length,
    totalObservations: input.totalObservations,
    faultedObservations: input.faultedObservations,
  });

  const entrySimTimeMs = parcel.entrySimTimeMs ?? parcel.spawnSimTimeMs;
  const exitSimTimeMs = parcel.exitSimTimeMs ?? simTimeMs;

  return {
    parcelId: parcel.parcelId,
    status,
    expectedLabels: parcel.spec.labels.length,
    decodedLabels: decodedLabels.length,
    uniquePayloads: new Set(payloads).size,
    payloads,
    labelResults,
    entrySimTimeMs,
    exitSimTimeMs,
    finalizedSimTimeMs: simTimeMs,
    entryToResultMs: simTimeMs - entrySimTimeMs,
    exitToResultMs: simTimeMs - exitSimTimeMs,
  };
}

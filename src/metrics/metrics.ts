/**
 * Run metrics (MET-001..MET-007): rates, percentiles, and breakdowns for
 * one completed run.
 *
 * MET-001  complete read rate — parcels where every expected label instance
 *          was decoded / parcels evaluated.
 * MET-002  barcode recall     — correctly decoded expected instances /
 *          all expected instances.
 * MET-003  barcode precision  — correctly decoded instances / all decoded
 *          instances (false decodes count against it).
 * MET-004  false decodes (ghost instances) and association mismatches,
 *          tracked separately (REV-11).
 * MET-005  observation collapse — how many repeated observations of the
 *          same physical instance the aggregator collapsed.
 * MET-006  latency percentiles (see latency.ts).
 * MET-007  read-rate breakdowns by camera / face / material / rotation /
 *          PPM band / angle band / reason code.
 *
 * Pure and deterministic: same inputs → same metrics (NFR-006). Ground
 * truth is allowed here (this is the audit/metrics path, not the decoder).
 */

import type {
  Face,
  MaterialPreset,
  ParcelResult,
  ParcelSpec,
} from '../domain/types';
import type { ParcelAggregate } from '../pipeline/aggregation';
import {
  breakdownBy,
  angleBand,
  ppmBand,
  rotationBand,
  type BreakdownRow,
} from './breakdowns';
import { latencySummary, type LatencySummary } from './latency';

/** One observed label instance (audit-level, from the driver's log). */
export interface MetricObservation {
  cameraId: string;
  parcelId: string;
  labelInstanceId: string;
  face: Face;
  material: MaterialPreset;
  rotationDeg: number;
  ppm: number;
  incidenceDeg: number;
  decoded: boolean;
  reasons: string[];
}

/**
 * One parcel: ground-truth identity + processing outcome. Minimal shape so
 * both live (ParcelState) and retired (FinalizedParcel) parcels qualify.
 */
export interface MetricParcelInput {
  parcel: { parcelId: string; spec: ParcelSpec };
  /** Finalized result, if the parcel has exited + grace elapsed. */
  result: ParcelResult | undefined;
  /** Pipeline aggregate (mismatches, per-instance observation counts). */
  aggregate: ParcelAggregate | undefined;
}

export interface RunBreakdowns {
  camera: BreakdownRow[];
  face: BreakdownRow[];
  material: BreakdownRow[];
  rotation: BreakdownRow[];
  ppm: BreakdownRow[];
  angle: BreakdownRow[];
  reason: BreakdownRow[];
}

export interface RunMetrics {
  /** Parcels with a finalized result (the denominator for MET-001). */
  evaluatedParcels: number;
  /** MET-001: fully-read parcels / evaluated parcels. */
  completeReadRate: number;
  /** MET-002: correct decodes of expected instances / expected instances. */
  barcodeRecall: number;
  /** MET-003: correct decodes / all decoded instances (incl. ghosts). */
  barcodePrecision: number;
  expectedInstances: number;
  /** All decoded instances (expected + ghost). */
  decodedInstances: number;
  /** Decodes matching the ground-truth payload of the instance. */
  correctDecodes: number;
  /** MET-004a: decoded instances that are not on the parcel (ghosts). */
  falseDecodes: number;
  /** MET-004b: association mismatches (unknown/ghost/stale) this run. */
  misassociations: number;
  /** MET-005: total label observations across all frames. */
  totalObservations: number;
  /** MET-005: distinct (parcel, instance) pairs observed at least once. */
  uniqueObservedInstances: number;
  /** MET-005: observations collapsed by instance-level dedup. */
  observationsCollapsed: number;
  /** MET-006. */
  latency: LatencySummary;
  /** MET-007. */
  breakdowns: RunBreakdowns;
}

export interface RunMetricsInput {
  parcels: MetricParcelInput[];
  observations: MetricObservation[];
  /** Per-decoded-observation capture→decode latency (MET-006 stage 1). */
  captureToDecodeSamplesMs?: number[];
}

const zeroRate = (n: number, d: number): number => (d === 0 ? 0 : n / d);

export function computeRunMetrics(input: RunMetricsInput): RunMetrics {
  const { parcels, observations } = input;

  let expectedInstances = 0;
  let correctDecodes = 0;
  let ghostDecodes = 0;
  let evaluatedParcels = 0;
  let completeReads = 0;
  let misassociations = 0;
  let totalObservations = 0;
  let uniqueObservedInstances = 0;

  const entryToResult: number[] = [];
  const exitToResult: number[] = [];
  const exitToAck: number[] = [];

  for (const { parcel, result, aggregate } of parcels) {
    misassociations += aggregate?.mismatches.length ?? 0;

    const expected = parcel.spec.labels;
    const expectedIds = new Set(expected.map((l) => l.labelInstanceId));
    const resultById = new Map(
      (result?.labelResults ?? []).map((lr) => [lr.labelInstanceId, lr]),
    );

    // MET-005: collapse accounting over every observed instance (incl. ghosts).
    for (const lr of result?.labelResults ?? []) {
      totalObservations += lr.observationCount;
      if (lr.observationCount > 0) uniqueObservedInstances += 1;
    }

    if (!result) continue;
    evaluatedParcels += 1;

    entryToResult.push(result.entryToResultMs);
    exitToResult.push(result.exitToResultMs);
    if (result.ackSimTimeMs !== undefined) {
      exitToAck.push(result.ackSimTimeMs - result.exitSimTimeMs);
    }

    let allExpectedDecoded = expected.length > 0;
    for (const label of expected) {
      expectedInstances += 1;
      const lr = resultById.get(label.labelInstanceId);
      const decoded = lr?.decoded ?? false;
      if (!decoded) allExpectedDecoded = false;
      // GEOMETRY_MODEL decodes return the ground-truth payload, so a decode
      // of the right instance is "correct"; a mismatch means the frame
      // content and the instance disagree (tracked, not hidden).
      if (decoded && lr && lr.decodedPayload === label.payload) {
        correctDecodes += 1;
      }
    }
    if (allExpectedDecoded) completeReads += 1;

    // MET-004a: decoded instances with no ground-truth label on the parcel.
    for (const lr of result.labelResults) {
      if (!expectedIds.has(lr.labelInstanceId) && lr.decoded) ghostDecodes += 1;
    }
  }

  const decodedInstances = correctDecodes + ghostDecodes;

  return {
    evaluatedParcels,
    completeReadRate: zeroRate(completeReads, evaluatedParcels),
    barcodeRecall: zeroRate(correctDecodes, expectedInstances),
    barcodePrecision: zeroRate(correctDecodes, decodedInstances),
    expectedInstances,
    decodedInstances,
    correctDecodes,
    falseDecodes: ghostDecodes,
    misassociations,
    totalObservations,
    uniqueObservedInstances,
    observationsCollapsed: totalObservations - uniqueObservedInstances,
    latency: latencySummary({
      captureToDecodeMs: input.captureToDecodeSamplesMs ?? [],
      entryToResultMs: entryToResult,
      exitToResultMs: exitToResult,
      exitToAckMs: exitToAck,
    }),
    breakdowns: {
      camera: breakdownBy(observations.map((o) => ({ key: o.cameraId, decoded: o.decoded }))),
      face: breakdownBy(observations.map((o) => ({ key: o.face, decoded: o.decoded }))),
      material: breakdownBy(observations.map((o) => ({ key: o.material, decoded: o.decoded }))),
      rotation: breakdownBy(observations.map((o) => ({ key: rotationBand(o.rotationDeg), decoded: o.decoded }))),
      ppm: breakdownBy(observations.map((o) => ({ key: ppmBand(o.ppm), decoded: o.decoded }))),
      angle: breakdownBy(observations.map((o) => ({ key: angleBand(o.incidenceDeg), decoded: o.decoded }))),
      reason: breakdownBy(
        observations.flatMap((o) => o.reasons.map((r) => ({ key: r, decoded: o.decoded }))),
      ),
    },
  };
}

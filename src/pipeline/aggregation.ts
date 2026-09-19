/**
 * Instance-level deduplication + parcel aggregation
 * (PIPE-006 `deduplicate`/`aggregate`, PIPE-007, REV-10).
 *
 * Repeated observations of the SAME physical label instance (same parcel +
 * labelInstanceId, across frames/cameras) collapse into one aggregated
 * entry: counts, best confidence, unique cameras. Identical payloads on
 * DIFFERENT instances are legitimately separate and are preserved —
 * dedup is keyed by physical instance, never by payload value.
 */

import { canonicalReasonOrder } from '../observation/reasons';
import type {
  AssociationMismatch,
  Face,
} from '../domain/types';
import type { AssociationResult } from './association';
import type { DecodeResult } from './decoder';

export interface AggregatedLabel {
  labelInstanceId: string;
  face: Face;
  /** Ground-truth payload of the instance (audit-facing). */
  payload: string;
  /** Value from the last validated decode. */
  decodedPayload?: string;
  decoded: boolean;
  bestConfidence: number;
  /** Every observation of this instance (MET-005). */
  observationCount: number;
  /** Validated decodes. */
  decodedCount: number;
  /** Unique camera ids, first-seen order. */
  cameras: string[];
  /** Union of reason codes, stable canonical order. */
  reasons: string[];
  firstObsMs: number;
  lastObsMs: number;
}

export interface ParcelAggregate {
  parcelId: string;
  /** Insertion order of first-seen instances. */
  labels: AggregatedLabel[];
  /** Association failures (ghost/unknown) attributed to this parcel. */
  mismatches: AssociationMismatch[];
}

export function newAggregate(parcelId: string): ParcelAggregate {
  return { parcelId, labels: [], mismatches: [] };
}

export interface AggregateInput {
  parcelId: string;
  labelInstanceId: string;
  face: Face;
  /** Ground-truth payload of the instance. */
  payload: string;
  confidence: number;
  reasons: string[];
  cameraId: string;
  simTimeMs: number;
  decode: DecodeResult;
  association: AssociationResult;
}

/** Fold one (observation, decode, association) triple into the aggregate. */
export function addObservation(
  agg: ParcelAggregate,
  input: AggregateInput,
): ParcelAggregate {
  if (!input.association.ok) {
    agg.mismatches.push(input.association.mismatch ?? 'GHOST_INSTANCE');
    return agg;
  }

  let entry = agg.labels.find((l) => l.labelInstanceId === input.labelInstanceId);
  if (!entry) {
    entry = {
      labelInstanceId: input.labelInstanceId,
      face: input.face,
      payload: input.payload,
      decoded: false,
      bestConfidence: 0,
      observationCount: 0,
      decodedCount: 0,
      cameras: [],
      reasons: [],
      firstObsMs: input.simTimeMs,
      lastObsMs: input.simTimeMs,
    };
    agg.labels.push(entry);
  }

  entry.observationCount += 1;
  entry.firstObsMs = Math.min(entry.firstObsMs, input.simTimeMs);
  entry.lastObsMs = Math.max(entry.lastObsMs, input.simTimeMs);
  if (!entry.cameras.includes(input.cameraId)) entry.cameras.push(input.cameraId);

  for (const r of input.reasons) {
    if (!entry.reasons.includes(r)) entry.reasons.push(r);
  }
  entry.reasons = canonicalReasonOrder(entry.reasons);

  if (input.decode.decoded) {
    entry.decoded = true;
    entry.decodedCount += 1;
    entry.decodedPayload = input.decode.decodedPayload;
    entry.bestConfidence = Math.max(entry.bestConfidence, input.decode.confidence);
  }
  return agg;
}

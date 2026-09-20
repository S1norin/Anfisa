/**
 * Parcel pipeline timeline derivation (t11, PIPE-006):
 *   spawned → entered → captured → decoded → aggregated → finalized → PLC ACK
 *
 * Pure and headless-friendly: the UI renders whatever this returns.
 * Inputs are the append-only event logs (sim + pipeline), the parcel's
 * live/retired state, its audit observations, and its aggregate.
 */

import type {
  FinalizedParcel,
  ParcelResult,
  ParcelState,
  SimEvent,
} from '../../domain/types';
import type { ParcelAggregate } from '../../pipeline/aggregation';
import type { RunObservationMeta } from '../../metrics/runRecord';

export type TimelineStageId =
  | 'SPAWNED'
  | 'ENTERED'
  | 'CAPTURED'
  | 'DECODED'
  | 'AGGREGATED'
  | 'FINALIZED'
  | 'ACK';

export interface TimelineStage {
  id: TimelineStageId;
  label: string;
  /** Sim time the stage completed; null = not reached yet. */
  simTimeMs: number | null;
}

export interface ParcelTimelineInput {
  parcelId: string;
  parcel: ParcelState | undefined;
  retired: FinalizedParcel | undefined;
  result: ParcelResult | undefined;
  aggregate: ParcelAggregate | undefined;
  observations: readonly RunObservationMeta[];
  simEvents: readonly SimEvent[];
  pipelineEvents: readonly SimEvent[];
}

export const TIMELINE_STAGE_ORDER: readonly {
  id: TimelineStageId;
  label: string;
}[] = [
  { id: 'SPAWNED', label: 'Spawned' },
  { id: 'ENTERED', label: 'Entered' },
  { id: 'CAPTURED', label: 'Captured' },
  { id: 'DECODED', label: 'Decoded' },
  { id: 'AGGREGATED', label: 'Aggregated' },
  { id: 'FINALIZED', label: 'Finalized' },
  { id: 'ACK', label: 'PLC ACK' },
] as const;

/** First capture event whose trigger zone included the parcel. */
function firstCaptureMs(
  simEvents: readonly SimEvent[],
  parcelId: string,
): number | null {
  const ev = simEvents.find(
    (e) =>
      e.type === 'CAMERA_CAPTURED' && e.candidateParcelIds.includes(parcelId),
  );
  return ev && ev.type === 'CAMERA_CAPTURED' ? ev.simTimeMs : null;
}

/** Derive the seven stage timestamps for one parcel. */
export function parcelTimelineStages(
  input: ParcelTimelineInput,
): TimelineStage[] {
  const { parcelId } = input;

  const firstDecoded = input.observations.find(
    (o) => o.parcelId === parcelId && o.decoded,
  );
  // First successfully attributed observation = first aggregate entry
  // (labels are created in first-seen order; failed associations only
  // land in `mismatches`, never in `labels`).
  const firstAggregated = input.aggregate?.labels[0]?.firstObsMs ?? null;

  const finalized = input.pipelineEvents.find(
    (e) => e.type === 'PARCEL_FINALIZED' && e.parcelId === parcelId,
  );
  const acked = input.pipelineEvents.find(
    (e) => e.type === 'PARCEL_ACKED' && e.parcelId === parcelId,
  );

  const times: Record<TimelineStageId, number | null> = {
    SPAWNED: input.parcel?.spawnSimTimeMs ?? input.retired?.spawnSimTimeMs ?? null,
    ENTERED:
      input.parcel?.entrySimTimeMs ?? input.retired?.entrySimTimeMs ?? null,
    CAPTURED: firstCaptureMs(input.simEvents, parcelId),
    DECODED: firstDecoded ? firstDecoded.simTimeMs : null,
    AGGREGATED: firstAggregated,
    FINALIZED: finalized ? finalized.simTimeMs : null,
    ACK: acked ? acked.simTimeMs : null,
  };

  return TIMELINE_STAGE_ORDER.map(({ id, label }) => ({
    id,
    label,
    simTimeMs: times[id],
  }));
}

/** The most recent stage with a timestamp (the parcel's current position). */
export function currentTimelineStage(
  stages: readonly TimelineStage[],
): TimelineStage | null {
  let current: TimelineStage | null = null;
  for (const s of stages) {
    if (s.simTimeMs !== null) current = s;
  }
  return current;
}

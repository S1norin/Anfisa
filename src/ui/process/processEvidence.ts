/**
 * How-It-Works evidence model (t11): maps a parcel's event stream
 * (sim + line-scan + pipeline events) plus its observations and final
 * result to per-stage status (pending/active/complete/failed) and live
 * aggregate counts.
 *
 * PURE: same input → same output. No clock, no random, no React/Three.
 * Statuses are derived ONLY from the evidence in the input — a stage is
 * 'active' when its trigger fired but its terminal event has not,
 * 'failed' when the stream carries an explicit failure for that stage.
 */

import type { ParcelResultStatus, SimEvent } from '../../domain/types';
import { PROCESS_GUIDE } from './processGuide';

export type StageStatus = 'pending' | 'active' | 'complete' | 'failed';

export interface StageEvidence {
  /** ProcessStage.id (guide order). */
  stageId: string;
  status: StageStatus;
  /** Human detail for failed stages (reason code / status) and counts. */
  detail?: string;
  /** Evidence item count (captures, decoded labels, …). */
  count?: number;
}

/** Minimal observation shape (a RunObservationMeta slice). */
export interface ObservationEvidence {
  decoded: boolean;
  qualityPassed: boolean;
  reasons: string[];
}

export interface ProcessEvidenceInput {
  parcelId: string;
  /** Ordered sim event stream (append-only, run start → now). */
  events: readonly SimEvent[];
  /** Observations of this parcel across all frames/strips so far. */
  observations: readonly ObservationEvidence[];
  /** Final result, present once the parcel is finalized. */
  result?: {
    status: ParcelResultStatus;
    expectedLabels: number;
    decodedLabels: number;
  };
}

export interface ProcessEvidenceOutput {
  /** One StageEvidence per guide stage, in guide order. */
  stages: StageEvidence[];
  /** Acquisitions so far (area captures + opened line-scan sessions). */
  captureCount: number;
  /** Decoded observations of this parcel so far. */
  decodedCount: number;
  /** Final result status, if finalized. */
  finalStatus?: ParcelResultStatus;
}

/** Count acquisitions: area captures + one per opened line session. */
function countEvidence(events: readonly SimEvent[], parcelId: string) {
  let spawned = false;
  let entered = false;
  let exited = false;
  let acked = false;
  let sorted = false;
  let finalStatus: ParcelResultStatus | undefined;
  let triggered = false;
  let areaCaptures = 0;
  let lineStarted = 0;
  let lineCompleted = 0;
  const lineAbortReasons: string[] = [];

  for (const ev of events) {
    switch (ev.type) {
      case 'PARCEL_SPAWNED':
        if (ev.parcelId === parcelId) spawned = true;
        break;
      case 'PARCEL_ENTERED':
        if (ev.parcelId === parcelId) entered = true;
        break;
      case 'PARCEL_EXITED':
        if (ev.parcelId === parcelId) exited = true;
        break;
      case 'PARCEL_ACKED':
        if (ev.parcelId === parcelId) acked = true;
        break;
      case 'PARCEL_SORTED':
        if (ev.parcelId === parcelId) sorted = true;
        break;
      case 'PARCEL_FINALIZED':
        if (ev.parcelId === parcelId) finalStatus = ev.status;
        break;
      case 'CAMERA_CAPTURED':
        if (ev.candidateParcelIds.includes(parcelId)) {
          triggered = true;
          areaCaptures += 1;
        }
        break;
      case 'LINE_SCAN_STARTED':
        if (ev.parcelId === parcelId) {
          triggered = true;
          lineStarted += 1;
        }
        break;
      case 'LINE_SCAN_COMPLETED':
        if (ev.parcelId === parcelId) {
          triggered = true;
          lineCompleted += 1;
        }
        break;
      case 'LINE_SCAN_ABORTED':
        if (ev.parcelId === parcelId) {
          triggered = true;
          lineAbortReasons.push(ev.reason);
        }
        break;
      default:
        break; // RUN_RESET, SPEED_CHANGED — not parcel evidence
    }
  }

  return {
    spawned,
    entered,
    exited,
    acked,
    sorted,
    finalStatus,
    triggered,
    areaCaptures,
    lineStarted,
    lineCompleted,
    lineAbortReasons,
  };
}

/**
 * Derive per-stage evidence for one parcel. Deterministic: the same
 * (parcelId, events, observations, result) always yields the same output.
 */
export function processEvidence(
  input: ProcessEvidenceInput,
): ProcessEvidenceOutput {
  const { parcelId, observations, result } = input;
  const c = countEvidence(input.events, parcelId);

  const decodedCount = observations.filter((o) => o.decoded).length;
  const qualityPassedCount = observations.filter((o) => o.qualityPassed)
    .length;
  const firstFailReason = observations.find((o) => !o.qualityPassed)?.reasons[0];

  const captureCount = c.areaCaptures + c.lineStarted;
  const closedCaptures = c.areaCaptures + c.lineCompleted;
  const openStrips = c.lineStarted - c.lineCompleted - c.lineAbortReasons.length;

  const stages: StageEvidence[] = [];
  const push = (stageId: string, status: StageStatus, extra?: Partial<StageEvidence>) => {
    stages.push({ stageId, status, ...extra });
  };

  // 1 created
  push(
    'created',
    c.spawned ? 'complete' : 'pending',
  );
  // 2 entry & tracking
  push(
    'entry-tracking',
    c.entered ? 'complete' : c.spawned ? 'active' : 'pending',
  );
  // 3 reader triggering
  push(
    'reader-triggering',
    c.triggered ? 'complete' : c.entered ? 'active' : 'pending',
  );
  // 4 acquisition
  if (closedCaptures > 0) {
    push('acquisition', 'complete', { count: closedCaptures });
  } else if (openStrips > 0) {
    push('acquisition', 'active', { count: c.lineStarted });
  } else if (c.lineAbortReasons.length > 0) {
    push('acquisition', 'failed', {
      detail: c.lineAbortReasons.join(','),
      count: c.lineAbortReasons.length,
    });
  } else {
    push('acquisition', 'pending');
  }
  // 5 preprocessing (every capture is preprocessed in the same step)
  push(
    'preprocessing',
    captureCount > 0 ? 'complete' : 'pending',
    captureCount > 0 ? { count: captureCount } : undefined,
  );
  // 6 quality gating
  if (observations.length > 0) {
    if (qualityPassedCount > 0) {
      push('quality-gating', 'complete', { count: qualityPassedCount });
    } else {
      push('quality-gating', 'failed', {
        detail: firstFailReason ?? 'QUALITY_GATE',
      });
    }
  } else if (captureCount > 0) {
    push('quality-gating', 'active');
  } else {
    push('quality-gating', 'pending');
  }
  // 7 decode
  if (decodedCount > 0) {
    push('decode', 'complete', { count: decodedCount });
  } else if (qualityPassedCount > 0) {
    push('decode', 'failed', { detail: 'no accepted decode' });
  } else {
    push('decode', 'pending');
  }
  // 8 association
  if (decodedCount > 0) {
    push('association', 'complete', { count: decodedCount });
  } else if (qualityPassedCount > 0) {
    push('association', 'failed', { detail: 'no decodes to associate' });
  } else {
    push('association', 'pending');
  }
  // 9 dedup & aggregation
  if (result) {
    push('dedup-aggregation', 'complete', {
      detail: `${result.decodedLabels}/${result.expectedLabels}`,
    });
  } else if (decodedCount > 0) {
    push('dedup-aggregation', 'active', { count: decodedCount });
  } else {
    push('dedup-aggregation', 'pending');
  }
  // 10 exit & finalization
  if (c.finalStatus) {
    push('exit-finalization', 'complete', { detail: c.finalStatus });
  } else if (c.exited) {
    push('exit-finalization', 'active');
  } else {
    push('exit-finalization', 'pending');
  }
  // 11 PLC ACK & sort
  if (c.sorted) {
    push('plc-ack-sort', 'complete');
  } else if (c.acked) {
    push('plc-ack-sort', 'active');
  } else {
    push('plc-ack-sort', 'pending');
  }

  return {
    stages,
    captureCount,
    decodedCount,
    ...(result ? { finalStatus: result.status } : {}),
  };
}

/** Guide-stage lookup (id → title/group) for the evidence rows. */
export const GUIDE_BY_ID: ReadonlyMap<string, (typeof PROCESS_GUIDE)[number]> =
  new Map(PROCESS_GUIDE.map((s) => [s.id, s]));

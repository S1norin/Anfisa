/**
 * Parcel pipeline (PIPE-006): capture → candidate → quality → decode →
 * associate → deduplicate → aggregate → finalize → ACK.
 *
 * `capture`/`quality` already ran in the observation engine (issue #8);
 * this machine owns the rest. It is pure state (no timers, no DOM) so a
 * headless e2e test can drive it with deterministic frames.
 */

import type { SimConfig } from '../domain/config';
import type {
  CameraState,
  ParcelResult,
  ParcelState,
  SimEvent,
} from '../domain/types';
import { decodeObservation } from './decoder';
import { associateObservation, DEFAULT_ASSOCIATION_WINDOWS } from './association';
import type { AssociationWindows } from './association';
import {
  addObservation,
  newAggregate,
  type ParcelAggregate,
} from './aggregation';
import {
  finalizeParcel,
  parcelReadyToFinalize,
  type FinalizeInput,
} from './finalize';
import type {
  LabelObservationResult,
} from '../observation/observationEngine';

/**
 * A capture that reached the pipeline: frame metadata + the engine's label
 * observations (which already carry the seeded quality decision).
 */
export interface PipelineFrame {
  frameId: string;
  cameraId: string;
  cameraState: CameraState;
  simTimeMs: number;
  encoderPositionMm: number;
  candidateParcelIds: string[];
  labels: LabelObservationResult[];
}

interface ParcelStats {
  aggregate: ParcelAggregate;
  totalObservations: number;
  faultedObservations: number;
}

export interface ProcessedFrameStats {
  frameId: string;
  observations: number;
  decoded: number;
  mismatches: number;
}

export class ParcelPipeline {
  private readonly stats = new Map<string, ParcelStats>();
  readonly results: ParcelResult[] = [];
  readonly events: SimEvent[] = [];

  private getStats(parcelId: string): ParcelStats {
    let s = this.stats.get(parcelId);
    if (!s) {
      s = { aggregate: newAggregate(parcelId), totalObservations: 0, faultedObservations: 0 };
      this.stats.set(parcelId, s);
    }
    return s;
  }

  /**
   * Run one captured frame through candidate → decode → associate →
   * deduplicate → aggregate. Returns per-frame stats for metrics/audit.
   */
  processFrame(
    frame: PipelineFrame,
    now: { simTimeMs: number; encoderMm: number },
    parcels: Iterable<ParcelState>,
    windows: AssociationWindows = DEFAULT_ASSOCIATION_WINDOWS,
  ): ProcessedFrameStats {
    const byId = new Map<string, ParcelState>();
    for (const p of parcels) byId.set(p.parcelId, p);

    const stats = { frameId: frame.frameId, observations: 0, decoded: 0, mismatches: 0 };

    for (const obs of frame.labels) {
      // Candidate gate: the frame only attributes parcels in its trigger zone.
      if (!frame.candidateParcelIds.includes(obs.parcelId)) continue;

      const parcel = byId.get(obs.parcelId);
      const payload =
        parcel?.spec.labels.find((l) => l.labelInstanceId === obs.labelInstanceId)
          ?.payload ?? '';

      const decode = decodeObservation(obs, {
        labelInstanceId: obs.labelInstanceId,
        payload,
      });
      const assoc = associateObservation(
        obs,
        {
          cameraId: frame.cameraId,
          simTimeMs: frame.simTimeMs,
          encoderPositionMm: frame.encoderPositionMm,
        },
        parcel,
        now,
        windows,
      );

      const s = this.getStats(obs.parcelId);
      s.totalObservations += 1;
      if (obs.reasons.includes('CAMERA_FAULT')) s.faultedObservations += 1;

      const before = s.aggregate.mismatches.length;
      addObservation(s.aggregate, {
        parcelId: obs.parcelId,
        labelInstanceId: obs.labelInstanceId,
        face: obs.face,
        payload,
        confidence: obs.confidence,
        reasons: obs.reasons,
        cameraId: frame.cameraId,
        simTimeMs: frame.simTimeMs,
        decode,
        association: assoc,
      });
      stats.mismatches += s.aggregate.mismatches.length - before;
      stats.observations += 1;
      if (decode.decoded && assoc.ok) stats.decoded += 1;
    }
    return stats;
  }

  /** Finalize every parcel whose exit + grace has elapsed. Returns new results. */
  finalizeDue(
    simTimeMs: number,
    config: SimConfig,
    parcels: Iterable<ParcelState>,
  ): typeof this.results {
    const due: FinalizeInput[] = [];
    for (const p of parcels) {
      if (!parcelReadyToFinalize(p, simTimeMs, config.finalizeGraceMs)) continue;
      const s = this.getStats(p.parcelId);
      due.push({
        parcel: p,
        aggregate: s.aggregate,
        simTimeMs,
        finalizeGraceMs: config.finalizeGraceMs,
        totalObservations: s.totalObservations,
        faultedObservations: s.faultedObservations,
      });
    }
    const fresh: typeof this.results = [];
    for (const input of due) {
      if (this.results.some((r) => r.parcelId === input.parcel.parcelId)) continue;
      const result = finalizeParcel(input);
      this.results.push(result);
      fresh.push(result);
      this.events.push({
        type: 'PARCEL_FINALIZED',
        parcelId: result.parcelId,
        simTimeMs: simTimeMs,
        status: result.status,
      });
    }
    return fresh;
  }

  /**
   * ACK stage (PIPE-006 tail): every finalized result gets a simulated PLC
   * ACK after the configured latency. Idempotent — a parcel is acked once.
   * Returns the parcel ids acked this call.
   */
  ackDue(simTimeMs: number, ackLatencyMs: number): string[] {
    const acked: string[] = [];
    for (const r of this.results) {
      if (r.ackSimTimeMs !== undefined) continue;
      if (simTimeMs - r.finalizedSimTimeMs < ackLatencyMs) continue;
      r.ackSimTimeMs = simTimeMs;
      acked.push(r.parcelId);
      this.events.push({
        type: 'PARCEL_ACKED',
        parcelId: r.parcelId,
        simTimeMs: simTimeMs,
      });
    }
    return acked;
  }

  resultFor(parcelId: string): ParcelResult | undefined {
    return this.results.find((r) => r.parcelId === parcelId);
  }

  /**
   * The aggregate for a parcel (MET-004/MET-005 metrics). Undefined when
   * the parcel produced no attributed observations.
   */
  aggregateFor(parcelId: string): ParcelAggregate | undefined {
    return this.stats.get(parcelId)?.aggregate;
  }
}

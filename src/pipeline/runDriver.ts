/**
 * Headless processing run (issue #10 baseline, reused by issue #11): wires
 * the deterministic Simulation (t7) + observation engine (t8) + parcel
 * pipeline (t9) into one driver that can run an entire scenario to
 * completion and emit the immutable run record (MET-008).
 *
 * No DOM, no timers: each `step()` is exactly one 5 ms domain step —
 * advance sim, feed every capture the scheduler emitted during that step
 * through the observation engine + pipeline, then finalize/ACK. Capture and
 * decode therefore share the same sim time (zero queueing delay), which
 * keeps association windows exact (REV-05).
 */

import type { Face } from '../domain/types';
import type { SimConfig } from '../domain/config';
import { Simulation } from '../simulation/sim';
import { ParcelPipeline } from './pipeline';
import { feedAcquisition, feedCaptureEvent } from './feedCapture';
import {
  buildRunRecord,
  type RunFrameMeta,
  type RunObservationMeta,
  type RunRecord,
} from '../metrics/runRecord';
import { computeRunMetrics } from '../metrics/metrics';

interface CapturedEvent {
  cameraId: string;
  simTimeMs: number;
  candidateParcelIds: string[];
}

export class ProcessRun {
  readonly sim: Simulation;
  readonly pipeline = new ParcelPipeline();
  readonly frames: RunFrameMeta[] = [];
  readonly observations: RunObservationMeta[] = [];
  /** Total association mismatches this run (MET-004b cross-check). */
  totalMismatches = 0;
  /** Total decoded observations (MET-004a cross-check). */
  totalDecodedObservations = 0;
  /** When set, spawning stops after this many parcels (scenario control). */
  private readonly maxParcels?: number;
  /** Total parcels spawned so far (map size is wrong: parcels retire). */
  spawnedCount = 0;

  constructor(config: SimConfig, maxParcels?: number) {
    this.sim = new Simulation(config);
    this.maxParcels = maxParcels;
    this.sim.start();
  }

  /** One 5 ms domain step: advance, feed captures, finalize, ACK. */
  step(): void {
    const s = this.sim.state;
    const before = s.events.length;
    this.sim.step();
    for (const e of s.events.slice(before)) {
      if (e.type === 'PARCEL_SPAWNED') this.spawnedCount += 1;
      if (e.type === 'CAMERA_CAPTURED') this.feedCapture(e);
      // Bounded line-scan lifecycle (t4): only terminal events carry the
      // strip interval — STARTED is skipped by both consumers.
      if (
        e.type === 'LINE_SCAN_COMPLETED' ||
        e.type === 'LINE_SCAN_ABORTED'
      ) {
        this.feedLineStrip(e);
      }
    }
    this.pipeline.finalizeDue(s.simTimeMs, s.config, s.parcels.values());
    this.pipeline.ackDue(s.simTimeMs, s.config.ackLatencyMs);
  }

  /** Advance `n` domain steps. */
  stepMany(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /**
   * Run to completion: every spawned parcel finalized AND acked. The step
   * budget guards against a misconfigured scenario (e.g. a parcel that
   * never exits).
   */
  runToCompletion(maxSteps = 20000): void {
    for (let i = 0; i < maxSteps; i++) {
      this.step();
      const s = this.sim.state;
      if (
        this.maxParcels !== undefined &&
        this.spawnedCount >= this.maxParcels
      ) {
        // Spawning stops; the belt keeps running so the last parcels can
        // exit, finalize, and be acked.
        s.nextSpawnMs = Infinity;
      }
      if (s.nextSpawnMs !== Infinity) continue;
      const total = this.maxParcels ?? this.spawnedCount;
      const results = this.pipeline.results;
      const allDone =
        results.length === total &&
        results.every((r) => r.ackSimTimeMs !== undefined);
      if (allDone) return;
    }
  }

  /**
   * Feed one capture through the observation engine + pipeline. Uses the
   * same glue as the live store (feedCaptureEvent) so headless and live
   * runs are byte-identical for the same step sequence (NFR-006).
   */
  private feedCapture(e: CapturedEvent): void {
    const s = this.sim.state;
    const rig = s.config.cameraRigs.find((r) => r.id === e.cameraId);
    this.frames.push({
      frameId: `${e.cameraId}@${e.simTimeMs}`,
      cameraId: e.cameraId,
      simTimeMs: e.simTimeMs,
      encoderMm: s.encoderMm,
      candidateParcelIds: e.candidateParcelIds,
      processingMode: 'GEOMETRY_MODEL',
    });
    if (!rig) return;

    const out = feedCaptureEvent(
      {
        cameraId: e.cameraId,
        simTimeMs: e.simTimeMs,
        encoderMm: s.encoderMm,
        candidateParcelIds: e.candidateParcelIds,
        config: s.config,
        parcels: s.parcels,
        cameraState: s.cameraStates[rig.id] ?? 'OFFLINE',
        speedMmPerSec: s.speedMmPerSec,
      },
      this.pipeline,
    );
    this.observations.push(...out.observations);
    this.totalDecodedObservations += out.observations.filter((o) => o.decoded).length;
    this.totalMismatches += out.stats.mismatches;
  }

  /**
   * Feed one closed line strip through the SAME glue as the live store
   * (feedAcquisition), so headless and live runs stay byte-identical
   * (NFR-006).
   */
  private feedLineStrip(e: {
    type: 'LINE_SCAN_COMPLETED' | 'LINE_SCAN_ABORTED';
    cameraId: string;
    parcelId: string;
    simTimeMs: number;
    encoderStartMm: number;
    encoderEndMm: number;
    lineCount: number;
    complete: boolean;
    reason?: 'CAMERA_FAULT' | 'CLOSE_SPACING' | 'MAX_STRIP';
  }): void {
    const s = this.sim.state;
    const rig = s.config.cameraRigs.find((r) => r.id === e.cameraId);
    this.frames.push({
      frameId: `${e.cameraId}@${e.simTimeMs}`,
      cameraId: e.cameraId,
      simTimeMs: e.simTimeMs,
      encoderMm: s.encoderMm,
      candidateParcelIds: [e.parcelId],
      processingMode: 'GEOMETRY_MODEL',
    });
    if (!rig) return;

    const out = feedAcquisition(
      {
        kind: 'LINE_STRIP',
        cameraId: e.cameraId,
        simTimeMs: e.simTimeMs,
        encoderMm: s.encoderMm,
        parcelId: e.parcelId,
        encoderStartMm: e.encoderStartMm,
        encoderEndMm: e.encoderEndMm,
        lineCount: e.lineCount,
        complete: e.complete,
        ...(e.reason !== undefined ? { abortReason: e.reason } : {}),
        config: s.config,
        parcels: s.parcels,
        cameraState: s.cameraStates[rig.id] ?? 'OFFLINE',
        speedMmPerSec: s.speedMmPerSec,
      },
      this.pipeline,
    );
    this.observations.push(...out.observations);
    this.totalDecodedObservations += out.observations.filter((o) => o.decoded).length;
    this.totalMismatches += out.stats.mismatches;
  }

  /** Build the immutable run record for this (completed) run. */
  record(): RunRecord {
    const s = this.sim.state;
    // Metrics must cover retired parcels too: the live map only holds the
    // ones that have not sorted yet.
    const retiredIds = new Set(s.finalized.map((f) => f.parcelId));
    const metricParcels = [
      ...s.finalized,
      ...[...s.parcels.values()].filter((p) => !retiredIds.has(p.parcelId)),
    ];
    const metrics = computeRunMetrics({
      parcels: metricParcels.map((p) => ({
        parcel: { parcelId: p.parcelId, spec: p.spec },
        result: this.pipeline.resultFor(p.parcelId),
        aggregate: this.pipeline.aggregateFor(p.parcelId),
      })),
      observations: this.observations.map((o) => ({
        cameraId: o.cameraId,
        parcelId: o.parcelId,
        labelInstanceId: o.labelInstanceId,
        face: o.face as Face,
        material: o.material,
        rotationDeg: o.rotationDeg,
        ppm: o.ppm,
        incidenceDeg: o.incidenceDeg,
        decoded: o.decoded,
        reasons: o.reasons,
      })),
      // Capture and decode share the same 5 ms step → zero by construction.
      captureToDecodeSamplesMs: this.observations
        .filter((o) => o.decoded)
        .map(() => 0),
    });
    return buildRunRecord({
      runId: s.runId,
      seed: s.config.seed,
      // Headless runs always run the analytic geometry model; the pixel
      // path (PIXEL_DECODER) is a separate on-demand experiment (t4-labeling).
      processingMode: 'GEOMETRY_MODEL',
      config: s.config,
      simTimeMs: s.simTimeMs,
      encoderMm: s.encoderMm,
      // Retired parcels live in s.finalized; the map keeps only the rest.
      groundTruth: [
        ...s.finalized.map((f) => ({
          parcelId: f.parcelId,
          spec: f.spec,
          spawnSimTimeMs: f.spawnSimTimeMs,
          entrySimTimeMs: f.entrySimTimeMs,
          exitSimTimeMs: f.exitSimTimeMs,
          sortSimTimeMs: f.sortSimTimeMs,
        })),
        ...[...s.parcels.values()]
          .filter((p) => !s.finalized.some((f) => f.parcelId === p.parcelId))
          .map((p) => ({
            parcelId: p.parcelId,
            spec: p.spec,
            spawnSimTimeMs: p.spawnSimTimeMs,
            entrySimTimeMs: p.entrySimTimeMs,
            exitSimTimeMs: p.exitSimTimeMs,
            sortSimTimeMs: p.sortSimTimeMs,
          })),
      ],
      frames: this.frames,
      observations: this.observations,
      results: [...this.pipeline.results],
      metrics,
      simEvents: [...s.events],
      pipelineEvents: [...this.pipeline.events],
    });
  }
}

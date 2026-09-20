import { useSyncExternalStore } from 'react';
import { nextCameraState, syncCameraStates } from '../domain/camera';
import type { SimConfig } from '../domain/config';
import { defaultConfig } from '../domain/config';
import type {
  Face,
  ParcelResult,
  SimEvent,
} from '../domain/types';
import { recommendedSixViewConfig } from '../capture/presets';
import type { RunObservationMeta } from '../metrics/runRecord';
import { computeRunMetrics, type RunMetrics } from '../metrics/metrics';
import { feedCaptureEvent } from '../pipeline/feedCapture';
import { ParcelPipeline } from '../pipeline/pipeline';
import type { ParcelAggregate } from '../pipeline/aggregation';
import { Simulation } from '../simulation/sim';

/**
 * Versioned simulation store (store/ — §9 architecture).
 *
 * The domain simulation runs OUTSIDE React: `sim.pump()` is called from the
 * render loop, then a version tick lets React re-read `sim.state` via
 * `useSyncExternalStore`. React never drives the domain clock per-frame.
 */

export class SimStore {
  private simInstance: Simulation;
  private snapshot: { version: number; sim: Simulation };

  constructor(initialConfig: SimConfig = defaultConfig()) {
    this.simInstance = new Simulation(initialConfig);
    this.snapshot = { version: 0, sim: this.simInstance };
  }
  /**
   * Live processing pipeline (t11): the store feeds every scheduled
   * capture through the SAME glue as the headless driver
   * (feedCaptureEvent), so live runs decode identically to ProcessRun
   * for the same step sequence (NFR-006). Capture and decode share the
   * same domain step — zero queueing delay.
   */
  private pipelineInstance = new ParcelPipeline();
  /** Audit-level observation log for live metrics + camera wall. */
  private observations: RunObservationMeta[] = [];
  /** Cursor into the sim event log (append-only; rewinds on reset). */
  private consumedEvents = 0;
  private spawnedCount = 0;
  private decodedObservations = 0;
  private misassociations = 0;
  private version = 0;
  private listeners = new Set<() => void>();

  get sim(): Simulation {
    return this.simInstance;
  }

  /** Finalized results, in finalize order. */
  get results(): readonly ParcelResult[] {
    return this.pipelineInstance.results;
  }

  /** Every label observation this run (audit-level, for the metrics panel). */
  get liveObservations(): readonly RunObservationMeta[] {
    return this.observations;
  }

  /** Processing events (PARCEL_FINALIZED / PARCEL_ACKED). */
  get pipelineEvents(): readonly SimEvent[] {
    return this.pipelineInstance.events;
  }

  get parcelsSpawned(): number {
    return this.spawnedCount;
  }

  get totalDecodedObservations(): number {
    return this.decodedObservations;
  }

  get totalMisassociations(): number {
    return this.misassociations;
  }

  resultFor(parcelId: string): ParcelResult | undefined {
    return this.pipelineInstance.resultFor(parcelId);
  }

  aggregateFor(parcelId: string): ParcelAggregate | undefined {
    return this.pipelineInstance.aggregateFor(parcelId);
  }

  /**
   * Live run metrics (MET-001..MET-006 over everything so far): same
   * inputs as the headless record, same pure computation.
   */
  computeLiveMetrics(): RunMetrics {
    const s = this.sim.state;
    const retiredIds = new Set(s.finalized.map((f) => f.parcelId));
    const metricParcels = [
      ...s.finalized,
      ...[...s.parcels.values()].filter((p) => !retiredIds.has(p.parcelId)),
    ];
    return computeRunMetrics({
      parcels: metricParcels.map((p) => ({
        parcel: { parcelId: p.parcelId, spec: p.spec },
        result: this.pipelineInstance.resultFor(p.parcelId),
        aggregate: this.pipelineInstance.aggregateFor(p.parcelId),
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
      // Capture and decode share the same domain step → 0 by construction.
      captureToDecodeSamplesMs: this.observations
        .filter((o) => o.decoded)
        .map(() => 0),
    });
  }

  getState = (): { version: number; sim: Simulation } => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    this.version += 1;
    this.snapshot = { version: this.version, sim: this.sim };
    for (const l of this.listeners) l();
  }

  /**
   * Advance from the display loop, then tick React — but only when the
   * sim clock actually moved (a paused/idle store re-rendering 60x/s for
   * nothing is pure waste).
   */
  tick(realElapsedMs: number): void {
    const before = this.sim.state.simTimeMs;
    this.sim.pump(realElapsedMs);
    this.processNewEvents();
    if (this.sim.state.simTimeMs !== before) this.notify();
  }

  /**
   * Feed every capture scheduled since the last tick through the live
   * pipeline, then advance finalize/ACK. Pure over domain steps: the
   * result of N steps is independent of how ticks were chunked
   * (association windows absorb the ≤ tick drift; NFR-006).
   */
  private processNewEvents(): void {
    const s = this.sim.state;
    // Reset shrinks the log — rewind the cursor.
    if (s.events.length < this.consumedEvents) this.consumedEvents = 0;

    while (this.consumedEvents < s.events.length) {
      const ev = s.events[this.consumedEvents++];
      if (ev.type === 'PARCEL_SPAWNED') {
        this.spawnedCount += 1;
      } else if (ev.type === 'CAMERA_CAPTURED') {
        const rig = s.config.cameraRigs.find((r) => r.id === ev.cameraId);
        if (!rig) continue;
        const out = feedCaptureEvent(
          {
            cameraId: ev.cameraId,
            simTimeMs: ev.simTimeMs,
            encoderMm: s.encoderMm,
            candidateParcelIds: ev.candidateParcelIds,
            config: s.config,
            parcels: s.parcels,
            cameraState: s.cameraStates[ev.cameraId] ?? 'OFFLINE',
            speedMmPerSec: s.speedMmPerSec,
          },
          this.pipelineInstance,
        );
        this.observations.push(...out.observations);
        this.decodedObservations +=
          out.observations.filter((o) => o.decoded).length;
        this.misassociations += out.stats.mismatches;
      }
    }

    this.pipelineInstance.finalizeDue(
      s.simTimeMs,
      s.config,
      s.parcels.values(),
    );
    this.pipelineInstance.ackDue(s.simTimeMs, s.config.ackLatencyMs);
  }

  start(): void {
    this.sim.start();
    this.notify();
  }

  pause(): void {
    this.sim.pause();
    this.notify();
  }

  reset(config?: SimConfig): void {
    this.sim.reset(config);
    this.pipelineInstance = new ParcelPipeline();
    this.observations = [];
    this.consumedEvents = 0;
    this.spawnedCount = 0;
    this.decodedObservations = 0;
    this.misassociations = 0;
    this.notify();
  }

  step(n = 1): void {
    this.sim.stepMany(n);
    this.notify();
  }

  setSpeed(mmPerSec: number): void {
    this.sim.setSpeed(mmPerSec);
    this.notify();
  }

  setSpeedFactor(f: 0.25 | 0.5 | 1 | 2): void {
    this.sim.setSpeedFactor(f);
    this.notify();
  }

  /**
   * Edit the live configuration (CAM-002, CFG-001). The caller is
   * responsible for validation (NFR-007); camera states are re-synced so
   * disabled rigs go OFFLINE and new rigs start IDLE.
   */
  updateConfig(mutator: (cfg: SimConfig) => SimConfig): void {
    const next = mutator(this.sim.state.config);
    this.sim.state.config = next;
    this.sim.state.cameraStates = syncCameraStates(
      next.cameraRigs,
      this.sim.state.cameraStates,
    );
    // Keep the fps-scheduling history aligned with the rig list.
    const kept: Record<string, number> = {};
    for (const rig of next.cameraRigs) {
      const t = this.sim.state.captureLastMs[rig.id];
      if (t !== undefined) kept[rig.id] = t;
    }
    this.sim.state.captureLastMs = kept;
    this.notify();
  }

  /**
   * Raise / clear a camera fault (CAM-009): flows through the CAM-004
   * state machine, so captures stop (FAULT rigs never schedule) and the
   * feed wall warns; clearing returns the rig to IDLE.
   */
  setCameraFault(id: string, faulted: boolean): void {
    const s = this.sim.state;
    const prev = s.cameraStates[id] ?? 'IDLE';
    s.cameraStates[id] = nextCameraState(prev, {
      type: faulted ? 'FAULT_RAISED' : 'FAULT_CLEARED',
    });
    this.notify();
  }
}

/** The live app defaults to the recommended 6-view preset — the layout
 *  that actually reads (bare defaultConfig geometry is a stress case,
 *  see the baseline in capture/presets.ts). */
export const simStore = new SimStore(recommendedSixViewConfig());

/** Subscribe a component to simulation version ticks. */
export function useSim(): Simulation {
  useSyncExternalStore(simStore.subscribe, simStore.getState);
  return simStore.sim;
}

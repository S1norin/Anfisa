import { useSyncExternalStore } from 'react';
import { nextCameraState, syncCameraStates } from '../domain/camera';
import type { SimConfig } from '../domain/config';
import { defaultConfig } from '../domain/config';
import { Simulation } from '../simulation/sim';

/**
 * Versioned simulation store (store/ — §9 architecture).
 *
 * The domain simulation runs OUTSIDE React: `sim.pump()` is called from the
 * render loop, then a version tick lets React re-read `sim.state` via
 * `useSyncExternalStore`. React never drives the domain clock per-frame.
 */

export class SimStore {
  private simInstance = new Simulation(defaultConfig());
  private version = 0;
  private listeners = new Set<() => void>();
  /**
   * Cached snapshot — `useSyncExternalStore` compares snapshots with
   * Object.is, so a fresh object per call would loop React forever.
   */
  private snapshot = { version: 0, sim: this.simInstance };

  get sim(): Simulation {
    return this.simInstance;
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
    if (this.sim.state.simTimeMs !== before) this.notify();
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

export const simStore = new SimStore();

/** Subscribe a component to simulation version ticks. */
export function useSim(): Simulation {
  useSyncExternalStore(simStore.subscribe, simStore.getState);
  return simStore.sim;
}

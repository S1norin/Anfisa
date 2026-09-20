import { scheduleCaptures } from '../capture/scheduler';
import type { SimConfig } from '../domain/config';
import type { ParcelState } from '../domain/types';
import { FIXED_STEP_MS, type SimState, createSimState, spawnParcel } from './state';

/**
 * Fixed-step simulation (SIM-002, SIM-003, SIM-004, NFR-006).
 *
 * Determinism: `step(n)` advances the domain by exactly n fixed steps. A run
 * with the same config version and seed produces identical domain results
 * independent of display refresh rate — only `pump()` is display-coupled.
 */

export class Simulation {
  state: SimState;

  constructor(config: SimConfig) {
    this.state = createSimState(config);
  }

  reset(config?: SimConfig): void {
    if (config) this.state = createSimState(config);
    else this.state = createSimState(this.state.config);
  }

  start(): void {
    this.state.status = 'RUNNING';
  }

  pause(): void {
    if (this.state.status === 'RUNNING') this.state.status = 'PAUSED';
  }

  /** Change belt speed mid-run (SIM-004). Association uses encoder deltas, so it survives. */
  setSpeed(mmPerSec: number): void {
    const cfg = this.state.config.belt;
    const clamped = Math.min(cfg.speedMaxMmPerSec, Math.max(cfg.speedMinMmPerSec, mmPerSec));
    if (clamped === this.state.speedMmPerSec) return;
    this.state.events.push({
      type: 'SPEED_CHANGED',
      simTimeMs: this.state.simTimeMs,
      fromMmPerSec: this.state.speedMmPerSec,
      toMmPerSec: clamped,
    });
    this.state.speedMmPerSec = clamped;
  }

  setSpeedFactor(f: 0.25 | 0.5 | 1 | 2): void {
    this.state.speedFactor = f;
  }

  /** Advance the domain by exactly one fixed step (no-op unless RUNNING). */
  step(): void {
    if (this.state.status !== 'RUNNING') return;
    this.advanceStep();
  }

  /**
   * Advance exactly one fixed step while PAUSED (freeze + "step one frame"
   * controls, issue #13). Returns true when a step was executed.
   */
  stepOnce(): boolean {
    if (this.state.status !== 'PAUSED') return false;
    const prev = this.state.status;
    this.state.status = 'RUNNING';
    this.advanceStep();
    this.state.status = prev;
    return true;
  }

  private advanceStep(): void {
    const s = this.state;
    const dtMs = FIXED_STEP_MS;

    // 1. Belt encoder integrates speed (SIM-004).
    const dEncoder = (s.speedMmPerSec * dtMs) / 1000;
    s.encoderMm += dEncoder;
    s.simTimeMs += dtMs;

    // 2. Parcels follow the encoder delta (speed-change robust).
    for (const parcel of s.parcels.values()) {
      parcel.frontZMm += dEncoder;
      this.crossings(parcel);
    }

    // 3. Deterministic spawning: front-to-front interval (PAR-001).
    if (s.simTimeMs >= s.nextSpawnMs) {
      spawnParcel(s, s.simTimeMs);
      s.nextSpawnMs += s.config.parcel.spawnIntervalMs;
    }

    // 4. Capture scheduling (CAM-005): runs after motion so parcel centres
    //    are current. Pure — see capture/scheduler.ts.
    const scheduled = scheduleCaptures({
      rigs: s.config.cameraRigs,
      states: s.cameraStates,
      parcels: s.parcels.values(),
      simTimeMs: s.simTimeMs,
      lastCaptureMs: s.captureLastMs,
    });
    s.cameraStates = scheduled.states;
    s.captureLastMs = scheduled.lastCaptureMs;
    for (const c of scheduled.captures) {
      s.events.push({
        type: 'CAMERA_CAPTURED',
        cameraId: c.cameraId,
        simTimeMs: c.simTimeMs,
        candidateParcelIds: c.candidateParcelIds,
      });
    }
  }

  /** Advance `n` fixed steps. */
  stepMany(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /**
   * Display-rate pump: convert real elapsed ms into a bounded number of
   * domain steps using the speed factor. The ONLY display-coupled entry point.
   */
  pump(realElapsedMs: number): void {
    if (this.state.status !== 'RUNNING') return;
    const ideal = (realElapsedMs * this.state.speedFactor) / FIXED_STEP_MS;
    const steps = Math.min(Math.floor(ideal), 100); // cap: avoid death spirals
    this.stepMany(steps);
  }

  /** Photoeye entry/exit + sort-point crossings, robust at any step size. */
  private crossings(parcel: ParcelState): void {
    const s = this.state;
    const prevZ = parcel.frontZMm - (s.speedMmPerSec * FIXED_STEP_MS) / 1000;
    const entryZ = 0;
    const exitZ = s.config.station.lengthMm;
    const sortZ = exitZ + s.config.station.sortDistanceMm;

    if (parcel.phase === 'SORTED') {
      // Retire the parcel once fully past the sort point.
      if (parcel.frontZMm - parcel.spec.lengthMm >= sortZ) {
        this.retireParcel(parcel);
      }
      return;
    }

    if (parcel.phase === 'SPAWNED' && prevZ < entryZ && parcel.frontZMm >= entryZ) {
      parcel.phase = 'ENTERED';
      parcel.entrySimTimeMs = s.simTimeMs;
      s.events.push({
        type: 'PARCEL_ENTERED',
        parcelId: parcel.parcelId,
        simTimeMs: s.simTimeMs,
        encoderMm: s.encoderMm,
      });
    } else if (parcel.phase === 'ENTERED' && prevZ < exitZ && parcel.frontZMm >= exitZ) {
      parcel.phase = 'EXITED';
      parcel.exitSimTimeMs = s.simTimeMs;
      s.events.push({
        type: 'PARCEL_EXITED',
        parcelId: parcel.parcelId,
        simTimeMs: s.simTimeMs,
        encoderMm: s.encoderMm,
      });
    } else if (parcel.phase === 'EXITED' && prevZ < sortZ && parcel.frontZMm >= sortZ) {
      parcel.phase = 'SORTED';
      parcel.sortSimTimeMs = s.simTimeMs;
      s.events.push({
        type: 'PARCEL_SORTED',
        parcelId: parcel.parcelId,
        simTimeMs: s.simTimeMs,
        encoderMm: s.encoderMm,
      });
      // Retirement happens in subsequent steps via the SORTED branch.
    }
  }

  private retireParcel(parcel: ParcelState): void {
    const s = this.state;
    s.finalized.push({
      parcelId: parcel.parcelId,
      spec: parcel.spec,
      spawnSimTimeMs: parcel.spawnSimTimeMs,
      entrySimTimeMs: parcel.entrySimTimeMs ?? 0,
      exitSimTimeMs: parcel.exitSimTimeMs ?? 0,
      sortSimTimeMs: parcel.sortSimTimeMs ?? s.simTimeMs,
    });
    s.parcels.delete(parcel.parcelId);
  }
}

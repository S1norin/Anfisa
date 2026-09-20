import type { SimConfig } from '../domain/config';
import { defaultConfig } from '../domain/config';
import { syncCameraStates } from '../domain/camera';
import { createIdGenerator, createRng, type Rng } from '../domain/rng';
import type { CameraState, FinalizedParcel, ParcelState, SimEvent } from '../domain/types';
import type { LineScanSession } from '../capture/lineScanner';
import { buildParcelSpec } from './spawner';

/**
 * Deterministic simulation state (SIM-002).
 * The fixed-step domain clock is decoupled from React rendering (NFR-006):
 * tests drive `step()` directly; the display loop pumps a computed number of
 * steps per animation frame.
 */

export type SimStatus = 'IDLE' | 'RUNNING' | 'PAUSED';

export interface SimState {
  runId: string;
  config: SimConfig;
  status: SimStatus;
  simTimeMs: number;
  /** Current belt speed (SIM-004: changes are allowed mid-run). */
  speedMmPerSec: number;
  /** Belt encoder position, mm (SIM-004). */
  encoderMm: number;
  parcels: Map<string, ParcelState>;
  finalized: FinalizedParcel[];
  /** Append-only domain event log (audit, MET-008, NFR-006). */
  events: SimEvent[];
  rng: Rng;
  parcelIds: () => string;
  labelIds: () => string;
  /**
   * Payloads of labels created so far in this run (PAR-005).
   * Shared with the label generator so repeated payloads are legal and
   * reproducible.
   */
  payloadHistory: string[];
  /**
   * Per-rig runtime state (CAM-004). Synced from cameraRigs on creation and
   * on config edits; the acquisition scheduler (issue #6) drives transitions.
   */
  cameraStates: Record<string, CameraState>;
  /** Last capture sim time per camera (CAM-005 fps scheduling). */
  captureLastMs: Record<string, number>;
  /** Open line-scan sessions per line-rig id (t4, LINE_SCAN_* events). */
  lineScanSessions: Map<string, LineScanSession>;
  /** Display-rate speed factor (0.25/0.5/1/2) — presentation only. */
  speedFactor: 0.25 | 0.5 | 1 | 2;
  /** Sim time of the next spawn (robust to any interval/step combination). */
  nextSpawnMs: number;
}

export const FIXED_STEP_MS = 5; // 200 Hz domain step

export function createSimState(config: SimConfig = defaultConfig()): SimState {
  const seed = config.seed >>> 0;
  return {
    runId: `run-${seed.toString(36)}-${seed.toString(16).padStart(8, '0')}`,
    config,
    status: 'IDLE',
    simTimeMs: 0,
    speedMmPerSec: config.belt.speedMmPerSec,
    encoderMm: 0,
    parcels: new Map(),
    finalized: [],
    events: [{ type: 'RUN_RESET', simTimeMs: 0, seed }],
    rng: createRng(seed),
    parcelIds: createIdGenerator('P'),
    labelIds: createIdGenerator('L'),
    payloadHistory: [],
    cameraStates: syncCameraStates(config.cameraRigs, {}),
    captureLastMs: {},
    lineScanSessions: new Map(),
    speedFactor: 1,
    nextSpawnMs: config.parcel.spawnIntervalMs,
  };
}

export function sortPointZMm(state: SimState): number {
  return state.config.station.lengthMm + state.config.station.sortDistanceMm;
}

/** Spawn a new parcel: its front face starts one length behind the entry. */
export function spawnParcel(state: SimState, simTimeMs: number): ParcelState {
  const spec = buildParcelSpec(state);
  const parcel: ParcelState = {
    parcelId: state.parcelIds(),
    spec,
    spawnSimTimeMs: simTimeMs,
    spawnEncoderMm: state.encoderMm,
    frontZMm: -spec.lengthMm,
    phase: 'SPAWNED',
  };
  state.parcels.set(parcel.parcelId, parcel);
  state.events.push({
    type: 'PARCEL_SPAWNED',
    parcelId: parcel.parcelId,
    simTimeMs,
    encoderMm: state.encoderMm,
  });
  return parcel;
}

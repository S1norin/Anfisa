/**
 * Capture scheduler (CAM-005, CAM-004, issue #6): pure, deterministic.
 *
 * Trigger zone model: a camera's trigger zone is active while at least one
 * parcel's world centre projects onto its sensor grid (projectPointMm).
 * This doubles as the source of candidate parcel ids for frame metadata.
 *
 * Scheduling: a camera captures only when enabled, healthy (not FAULT),
 * ARMED (zone active), and at least one acquisition period (1/fps) has
 * elapsed since its last capture. All transitions go through the CAM-004
 * state machine in domain/camera.ts, so there is one source of truth.
 */

import { nextCameraState, projectPointMm } from '../domain/camera';
import type {
  CameraConfig,
  CameraState,
  ParcelState,
} from '../domain/types';

export interface CaptureRecord {
  cameraId: string;
  simTimeMs: number;
  candidateParcelIds: string[];
}

export interface ScheduleInput {
  rigs: CameraConfig[];
  states: Record<string, CameraState>;
  parcels: Iterable<ParcelState>;
  simTimeMs: number;
  /** Last capture sim time per camera (fps gating). */
  lastCaptureMs: Record<string, number>;
}

export interface ScheduleOutput {
  states: Record<string, CameraState>;
  lastCaptureMs: Record<string, number>;
  captures: CaptureRecord[];
}

/** Parcel world-space centre (mm). Belt top is y=0; parcels sit on it. */
export function parcelCentreMm(p: ParcelState): [number, number, number] {
  return [
    p.spec.lateralOffsetMm,
    p.spec.heightMm / 2,
    p.frontZMm - p.spec.lengthMm / 2,
  ];
}

/**
 * Ids of parcels whose centre projects onto the sensor (insertion order —
 * Map iteration is deterministic, so runs are reproducible).
 */
export function visibleParcelIds(
  rig: CameraConfig,
  parcels: Iterable<ParcelState>,
): string[] {
  const ids: string[] = [];
  for (const p of parcels) {
    if (projectPointMm(parcelCentreMm(p), rig)) ids.push(p.parcelId);
  }
  return ids;
}

/**
 * Advance every rig's state machine by one domain step and return the rigs
 * that capture this step. Disabled/offline/FAULT rigs never capture.
 */
export function scheduleCaptures(input: ScheduleInput): ScheduleOutput {
  const states: Record<string, CameraState> = { ...input.states };
  const lastCaptureMs: Record<string, number> = { ...input.lastCaptureMs };
  const captures: CaptureRecord[] = [];

  // Materialize ONCE: `input.parcels` may be a one-shot iterator (e.g.
  // Map.values()); each rig below needs the full list, not a drained one.
  const parcels = [...input.parcels];

  for (const rig of input.rigs) {
    if (!rig.enabled) continue;
    let state = states[rig.id] ?? 'OFFLINE';
    if (state === 'OFFLINE' || state === 'FAULT') continue;

    const visible = visibleParcelIds(rig, parcels);
    state = nextCameraState(state, {
      type: visible.length > 0 ? 'TRIGGER_ZONE_ACTIVE' : 'TRIGGER_ZONE_INACTIVE',
    });

    // One transition per step: the pipeline states (CAPTURING,
    // PROCESSING) stay visible for a step each on the feed wall.
    if (state === 'ARMED') {
      const minIntervalMs = 1000 / rig.acquisition.fps;
      const last = lastCaptureMs[rig.id] ?? Number.NEGATIVE_INFINITY;
      if (input.simTimeMs - last >= minIntervalMs) {
        state = nextCameraState(state, { type: 'CAPTURE_STARTED' });
        lastCaptureMs[rig.id] = input.simTimeMs;
        captures.push({
          cameraId: rig.id,
          simTimeMs: input.simTimeMs,
          candidateParcelIds: visible,
        });
      }
    } else if (state === 'CAPTURING') {
      state = nextCameraState(state, { type: 'CAPTURE_FINISHED' });
    } else if (state === 'PROCESSING') {
      state = nextCameraState(state, { type: 'PROCESSING_FINISHED' });
    }
    states[rig.id] = state;
  }

  return { states, lastCaptureMs, captures };
}

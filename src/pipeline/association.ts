/**
 * Observation → parcel association (PIPE-008, REV-05).
 *
 * Association is primarily by ENCODER POSITION: the parcel's expected front
 * position at the frame's encoder reading must lie within the position
 * window. Time is the secondary check (diagnostics/staleness). A decoded
 * observation whose instance is not on the attributed parcel is a GHOST —
 * a misassociation, tracked separately (REV-10), never silently dropped.
 */

import type {
  AssociationMismatch,
  ParcelState,
} from '../domain/types';

export interface AssociationFrame {
  cameraId: string;
  simTimeMs: number;
  encoderPositionMm: number;
}

export interface AssociationResult {
  ok: boolean;
  mismatch?: AssociationMismatch;
}

export interface AssociationWindows {
  /** Max |frame-front − now-front| in mm (stale frames drift by belt travel). */
  positionMm: number;
  /** Max |frame time − now time| in ms. */
  timeMs: number;
}

export const DEFAULT_ASSOCIATION_WINDOWS: AssociationWindows = {
  positionMm: 50,
  timeMs: 250,
};

/**
 * @param obs      observation with engine-attributed parcelId + instance
 * @param frame    capture metadata (time + encoder reading)
 * @param parcel   attributed parcel (undefined if it no longer exists)
 * @param now      current sim state (time + encoder reading)
 */
export function associateObservation(
  obs: { parcelId: string; labelInstanceId: string },
  frame: AssociationFrame,
  parcel: ParcelState | undefined,
  now: { simTimeMs: number; encoderMm: number },
  windows: AssociationWindows = DEFAULT_ASSOCIATION_WINDOWS,
): AssociationResult {
  if (!parcel) return { ok: false, mismatch: 'PARCEL_UNKNOWN' };

  const hasInstance = parcel.spec.labels.some(
    (l) => l.labelInstanceId === obs.labelInstanceId,
  );
  if (!hasInstance) return { ok: false, mismatch: 'GHOST_INSTANCE' };

  // Position window: where the parcel front WOULD be at the frame's encoder
  // reading vs where it is now. Stale frames drift by exactly the belt
  // travel in between, so this detects stale/wrong-parcel attribution.
  const frontAtFrame = parcel.frontZMm + (frame.encoderPositionMm - now.encoderMm);
  const positionDrift = Math.abs(frontAtFrame - parcel.frontZMm);
  if (positionDrift > windows.positionMm) {
    return { ok: false, mismatch: 'POSITION_OUT_OF_WINDOW' };
  }

  // Time window (diagnostics): observation must be fresh.
  if (Math.abs(now.simTimeMs - frame.simTimeMs) > windows.timeMs) {
    return { ok: false, mismatch: 'TIME_OUT_OF_WINDOW' };
  }

  return { ok: true };
}

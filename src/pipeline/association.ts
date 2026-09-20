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

/** A line strip's acquisition window (from the bounded t4 event). */
export interface LineStripInterval {
  simTimeMs: number;
  encoderStartMm: number;
  encoderEndMm: number;
}

/**
 * The encoder interval over which `parcel` crossed `scanPlaneZMm`,
 * expressed at the encoder reading `encoderNowMm` (the parcel's current
 * positions mapped back to their plane-crossing encoder readings).
 */
export function parcelTravelIntervalMm(
  parcel: ParcelState,
  encoderNowMm: number,
  scanPlaneZMm: number,
): [number, number] {
  const frontZ = parcel.frontZMm;
  const rearZ = frontZ - parcel.spec.lengthMm;
  const encoderAtFront = encoderNowMm - (frontZ - scanPlaneZMm);
  const encoderAtRear = encoderNowMm - (rearZ - scanPlaneZMm);
  return [
    Math.min(encoderAtFront, encoderAtRear),
    Math.max(encoderAtFront, encoderAtRear),
  ];
}

/**
 * Interval-based association for line strips (t6, plan: "scanner +
 * scan-plane crossing + encoder interval -> parcel scan session").
 *
 * The strip's encoder interval must overlap EXACTLY one parcel's travel
 * interval at the scan plane. At the closure step that parcel's interval
 * IS the strip interval; zero overlaps (parcel retired) or multiple
 * overlaps (ambiguous assignment) never fabricate a read.
 */
export function associateLineStrip(
  strip: LineStripInterval,
  parcel: ParcelState | undefined,
  allParcels: Iterable<ParcelState>,
  scanPlaneZMm: number,
  now: { simTimeMs: number; encoderMm: number },
  windows: AssociationWindows = DEFAULT_ASSOCIATION_WINDOWS,
): AssociationResult {
  if (!parcel) return { ok: false, mismatch: 'PARCEL_UNKNOWN' };

  // Freshness (plan: "the strip is fresh").
  if (Math.abs(now.simTimeMs - strip.simTimeMs) > windows.timeMs) {
    return { ok: false, mismatch: 'TIME_OUT_OF_WINDOW' };
  }

  const [a1, b1] = [strip.encoderStartMm, strip.encoderEndMm];
  let overlaps = 0;
  for (const p of allParcels) {
    const [a2, b2] = parcelTravelIntervalMm(p, now.encoderMm, scanPlaneZMm);
    if (a1 <= b2 && a2 <= b1) overlaps += 1;
  }
  if (overlaps !== 1) return { ok: false, mismatch: 'INTERVAL_AMBIGUOUS' };

  return { ok: true };
}

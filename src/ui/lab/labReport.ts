/**
 * Camera Lab report (issue #12): pure geometric readout of one rig aimed
 * at one parcel. Uses the SAME observation engine the capture pipeline
 * runs (PIPE-001..005), so the readout is exactly what the pipeline sees
 * at the frozen sim time — no separate approximation.
 *
 * Reports: physical FOV at the target plane, distance, per-label
 * incidence angle, projected PPM, estimated blur, coverage, quality and
 * the current readability reason codes.
 */

import {
  lookAtQuaternion,
  quatRotate,
  toCameraSpace,
  type Quat,
  type V3,
} from '../../domain/camera';
import type { SimConfig } from '../../domain/config';
import type {
  AreaScanCameraConfig,
  CameraConfig,
  CameraState,
  ParcelState,
} from '../../domain/types';
import {
  observeLabels,
  type LabelObservationResult,
} from '../../observation/observationEngine';
import { parcelCentreWorldMm } from '../../observation/projection';

/** Physical field of view + the world size visible at the target plane. */
export interface LabFov {
  vFovDeg: number;
  hFovDeg: number;
  /** mm of world visible at the parcel-centre distance. */
  planeWidthMm: number;
  planeHeightMm: number;
}

export interface LabReport {
  fov: LabFov;
  /** Camera → parcel centre distance (mm). */
  distanceMm: number;
  /** Every label on the parcel from this rig, best (confidence) first. */
  labels: LabelObservationResult[];
  best: LabelObservationResult | null;
}

/** Vertical FOV from the physical pinhole model (focal + film gauge). */
export function vFovDeg(rig: AreaScanCameraConfig): number {
  const s = rig.sensor;
  return (
    (2 * Math.atan(s.filmGaugeMm / 2 / s.focalLengthMm) * 180) / Math.PI
  );
}

/**
 * World-space look target along the camera axis (camera +Z) at the given
 * distance from the lens — the editable "aim point" of the lab.
 */
export function lookTargetMm(
  rig: CameraConfig,
  distanceMm: number,
): [number, number, number] {
  const fwd = quatRotate(rig.pose.quaternion, [0, 0, 1]);
  const [x, y, z] = rig.pose.positionMm;
  return [x + fwd[0] * distanceMm, y + fwd[1] * distanceMm, z + fwd[2] * distanceMm];
}

/** Re-aim a rig at a world point (returns a new pose, camera stays put). */
export function lookAtPoint(
  rig: CameraConfig,
  point: V3,
): { positionMm: [number, number, number]; quaternion: Quat } {
  return {
    positionMm: rig.pose.positionMm,
    quaternion: lookAtQuaternion(rig.pose.positionMm, point),
  };
}

/**
 * Full lab readout for one rig + one parcel at a (frozen) sim instant.
 *
 * @param simTimeMs  frozen time — drives the deterministic boundary roll
 * @param speedMmPerSec belt speed at that instant (motion-blur estimate)
 */
export function computeLabReport(
  rig: AreaScanCameraConfig,
  cameraState: CameraState,
  parcel: ParcelState,
  allParcels: ParcelState[],
  simTimeMs: number,
  speedMmPerSec: number,
  config: SimConfig,
): LabReport {
  const centre = parcelCentreWorldMm(parcel);
  const cam = toCameraSpace(centre, rig);
  const distanceMm = Math.hypot(cam[0], cam[1], cam[2]);

  const vFov = vFovDeg(rig);
  const aspect = rig.sensor.widthPx / rig.sensor.heightPx;
  const hFov =
    (2 * Math.atan(Math.tan((vFov * Math.PI) / 360) * aspect) * 180) / Math.PI;
  const planeHeightMm = 2 * distanceMm * Math.tan((vFov * Math.PI) / 360);
  const planeWidthMm = planeHeightMm * aspect;

  const labels = observeLabels(
    rig,
    cameraState,
    [parcel],
    allParcels,
    { simTimeMs, speedMmPerSec },
    config,
  );
  labels.sort((a, b) => b.confidence - a.confidence);

  return {
    fov: { vFovDeg: vFov, hFovDeg: hFov, planeWidthMm, planeHeightMm },
    distanceMm,
    labels,
    best: labels[0] ?? null,
  };
}

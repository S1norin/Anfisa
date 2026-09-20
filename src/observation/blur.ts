/**
 * Image-plane motion blur (IMG-001, IMG-002, PIPE-003).
 *
 * Standard pinhole approximation: while the shutter is open, a point moving
 * at `v_obj` (mm/s) sweeps the image plane at `v_img = fx · v_obj / z` (px/s).
 * The analytic blur length is `blurPx = v_img · t_exposure` — this is the
 * measured value the quality model (issue #8) consumes.
 *
 * The visual parameters (direction, tap length, sample count) are derived
 * from the same analytic value so the preview shows what the model measures;
 * `artifactAmplification` scales ONLY the visual side (IMG-003).
 */

import {
  quatConjugate,
  quatRotate,
  sensorIntrinsics,
  toCameraSpace,
} from '../domain/camera';
import type { AreaScanCameraConfig, LabelInstance, ParcelState } from '../domain/types';
import { labelCornersWorldMm } from './projection';

export interface BlurInput {
  /** Camera-space distance to the point, mm (> 0). */
  distanceMm: number;
  /** Object (belt) speed along travel, mm/s. */
  speedMmPerSec: number;
  /** Effective exposure time, s (shutter + readout — see effectiveExposureS). */
  exposureS: number;
  /** Focal length in pixels (fx = fy, square pixels). */
  focalPx: number;
}

/** Analytic motion-blur length in px (≥ 0). */
export function motionBlurPx(input: BlurInput): number {
  const { distanceMm, speedMmPerSec, exposureS, focalPx } = input;
  if (distanceMm <= 0 || speedMmPerSec <= 0 || exposureS <= 0) return 0;
  return (focalPx * speedMmPerSec * exposureS) / distanceMm;
}

/**
 * Global vs rolling shutter (IMG-004): a rolling sensor integrates each row
 * while it is being read out, so the worst-case row sees the full readout
 * PLUS the exposure window. Global shutter integrates the whole frame at
 * once.
 */
export function effectiveExposureS(rig: AreaScanCameraConfig): number {
  const expS = rig.acquisition.exposureUs / 1e6;
  if (rig.acquisition.shutter === 'ROLLING') {
    return expS + rig.acquisition.rollingReadoutUs / 1e6;
  }
  return expS;
}

/**
 * Analytic blur for a parcel (its world centre) at a given belt speed.
 */
export function parcelMotionBlurPx(
  rig: AreaScanCameraConfig,
  parcel: ParcelState,
  speedMmPerSec: number,
): number {
  const centre: [number, number, number] = [
    parcel.spec.lateralOffsetMm,
    parcel.spec.heightMm / 2,
    parcel.frontZMm - parcel.spec.lengthMm / 2,
  ];
  const cam = toCameraSpace(centre, rig);
  if (cam[2] <= 0) return 0;
  const intr = sensorIntrinsics(rig.sensor);
  return motionBlurPx({
    distanceMm: cam[2],
    speedMmPerSec,
    exposureS: effectiveExposureS(rig),
    focalPx: intr.fx,
  });
}

/**
 * Per-label motion blur, corner-based (PIPE-003, §8.1): project the four
 * label corners at shutter-open and at shutter-close (the parcel has
 * travelled `speed · exposure` along world +Z), then take the MAXIMUM
 * corner displacement in sensor pixels. This naturally accounts for
 * camera pose, perspective, label face and motion direction — no constant
 * pixels/mm assumption.
 *
 * Corners that are behind the camera at either instant are skipped (the
 * label is out of FOV; the quality model gates on coverage anyway).
 */
export function labelMotionBlurPx(
  rig: AreaScanCameraConfig,
  label: LabelInstance,
  parcel: ParcelState,
  speedMmPerSec: number,
): number {
  const exposureS = effectiveExposureS(rig);
  if (speedMmPerSec <= 0 || exposureS <= 0) return 0;
  const shiftMm = speedMmPerSec * exposureS;
  const closed: ParcelState = { ...parcel, frontZMm: parcel.frontZMm + shiftMm };
  const open = labelCornersWorldMm(label, parcel);
  const shut = labelCornersWorldMm(label, closed);
  const intr = sensorIntrinsics(rig.sensor);
  let max = 0;
  for (let i = 0; i < 4; i++) {
    const a = toCameraSpace(open[i], rig);
    if (a[2] <= 0) continue;
    const b = toCameraSpace(shut[i], rig);
    if (b[2] <= 0) continue;
    const x0 = intr.fx * (a[0] / a[2]) + intr.cx;
    const y0 = intr.cy - intr.fy * (a[1] / a[2]);
    const x1 = intr.fx * (b[0] / b[2]) + intr.cx;
    const y1 = intr.cy - intr.fy * (b[1] / b[2]);
    max = Math.max(max, Math.hypot(x1 - x0, y1 - y0));
  }
  return max;
}

export type BlurMode = 'OFF' | 'DIRECTIONAL' | 'TEMPORAL_ACCUMULATION';

export interface MotionBlurVisual {
  mode: BlurMode;
  /** Unit direction in image space (uv: +x right, +y up). */
  direction: [number, number];
  /** Total tap displacement, px (analytic × amplification). */
  lengthPx: number;
  /** Tap count (TEMPORAL_ACCUMULATION uses the rig's sample count). */
  samples: number;
  /**
   * Rolling-shutter wedge: horizontal uv shift at uv.y=0 vs uv.y=1, as a
   * fraction of the image height (IMG-004). 0 for global shutter.
   */
  rollingSkew: number;
}

/**
 * Image-space velocity direction of the belt (world +Z travel) as seen by
 * the rig, derived from the pose rotation alone (view direction).
 */
export function travelDirectionImageSpace(rig: AreaScanCameraConfig): [number, number] {
  // Camera-space velocity of world travel (same transform as toCameraSpace).
  const camV = quatRotate(quatConjugate(rig.pose.quaternion), [0, 0, 1]);
  // Image-space direction is the lateral component of the camera-space
  // velocity; normalizing removes the 1/z perspective factor (which would
  // diverge for top/bottom readers where travel ⊥ view axis).
  const x = camV[0];
  const y = -camV[1]; // image y is flipped (v grows down)
  const l = Math.hypot(x, y);
  return l < 1e-9 ? [0, 0] : [x / l, y / l];
}

/**
 * Visual motion-blur parameters (IMG-002). `amplification` (≥ 1) scales the
 * VISIBLE tap length and skew only — the analytic blurPx is returned by
 * parcelMotionBlurPx and never sees this factor (IMG-003).
 */
export function motionBlurVisual(
  rig: AreaScanCameraConfig,
  parcel: ParcelState,
  speedMmPerSec: number,
  amplification: number,
): MotionBlurVisual {
  const mode = rig.imageEffects.motionBlur;
  if (mode === 'OFF') {
    return {
      mode,
      direction: [0, 0],
      lengthPx: 0,
      samples: 1,
      rollingSkew: 0,
    };
  }
  const analyt = parcelMotionBlurPx(rig, parcel, speedMmPerSec);
  const intr = sensorIntrinsics(rig.sensor);
  const dir = travelDirectionImageSpace(rig);
  // Rolling readout wedge: displacement accumulated across the full sensor
  // height while rows stream out (image-space, fraction of height).
  const readoutS =
    rig.acquisition.shutter === 'ROLLING'
      ? rig.acquisition.rollingReadoutUs / 1e6
      : 0;
  const cam = toCameraSpace(
    [
      parcel.spec.lateralOffsetMm,
      parcel.spec.heightMm / 2,
      parcel.frontZMm - parcel.spec.lengthMm / 2,
    ],
    rig,
  );
  const skewPx =
    cam[2] > 0
      ? (intr.fx * speedMmPerSec * readoutS) / cam[2]
      : 0;
  return {
    mode,
    direction: dir,
    lengthPx: analyt * amplification,
    samples:
      mode === 'TEMPORAL_ACCUMULATION'
        ? Math.max(2, Math.round(rig.imageEffects.temporalSamples))
        : 8,
    rollingSkew: (skewPx * amplification) / rig.sensor.heightPx,
  };
}

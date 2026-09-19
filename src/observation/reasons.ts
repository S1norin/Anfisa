/**
 * Reason codes (PIPE-005): deterministic mapping from measured conditions
 * to the canonical ReasonCode set.
 *
 * A reason is emitted as soon as a condition falls below its TARGET
 * threshold (i.e. the corresponding quality component is < 1), so a
 * camera change immediately changes the reason list. Conditions that
 * breach the HARD gate (the "max" thresholds) emit the same code —
 * the quality model (quality.ts) separately reports the gate failure.
 *
 * Coverage shortfall maps to OUT_OF_FOV (part of the label is outside
 * the sensor grid). Print damage has no canonical code by design: it is
 * a quality component only, and a hard gate at `damageMax`.
 */

import type { ReasonCode } from '../domain/types';
import type { QualityThresholds } from '../domain/config';

/** Everything the reason mapper needs — also the quality model's input. */
export interface ReasonInput {
  /** All four projected corners in front of the camera. */
  inFov: boolean;
  /** Face normal points toward the camera. */
  frontFacing: boolean;
  /** Ray from camera to label centre hits another parcel first. */
  occluded: boolean;
  /** Rig is OFFLINE or FAULT. */
  cameraFault: boolean;
  /** Projected label area inside the sensor grid, 0..1. */
  coverage: number;
  /** Projected module width, px. */
  ppm: number;
  /** 0° = head-on. */
  incidenceDeg: number;
  /** Image-plane motion blur, px. */
  blurPx: number;
  /** Circle-of-confusion proxy, px. */
  focusPx: number;
  /** Contrast proxy, 0..1 (exposure-driven). */
  contrast: number;
  /** Specular glare index, 0..1. */
  glare: number;
  /** Print damage, 0..1. */
  damage: number;
}

/** Canonical emission order (stable for tests and UI). */
export const REASON_ORDER: readonly ReasonCode[] = [
  'OUT_OF_FOV',
  'BACK_FACING',
  'OCCLUDED',
  'LOW_PPM',
  'HIGH_ANGLE',
  'MOTION_BLUR',
  'GLARE',
  'LOW_CONTRAST',
  'OUT_OF_FOCUS',
  'CAMERA_FAULT',
];

/** Reason list for a set of measured conditions (empty = fully clean). */
export function labelReasons(
  i: ReasonInput,
  t: QualityThresholds,
): ReasonCode[] {
  const hit: Record<ReasonCode, boolean> = {
    OUT_OF_FOV: !i.inFov || i.coverage < t.coverageMin,
    BACK_FACING: !i.frontFacing,
    OCCLUDED: i.occluded,
    LOW_PPM: i.ppm < t.ppmTarget,
    HIGH_ANGLE: i.incidenceDeg > t.incidenceDegTarget,
    MOTION_BLUR: i.blurPx > t.blurPxTarget,
    GLARE: i.glare > t.glareMin,
    LOW_CONTRAST: i.contrast < t.contrastMin,
    OUT_OF_FOCUS: i.focusPx > t.focusPxTarget,
    CAMERA_FAULT: i.cameraFault,
  };
  return REASON_ORDER.filter((c) => hit[c]);
}

/**
 * Sort a reason list into canonical order (unknown codes last, alphabetically).
 * Used by aggregation so merged reason sets are stable for tests and the UI.
 */
export function canonicalReasonOrder(reasons: readonly string[]): string[] {
  return [...reasons].sort((a, b) => {
    const ia = REASON_ORDER.indexOf(a as ReasonCode);
    const ib = REASON_ORDER.indexOf(b as ReasonCode);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

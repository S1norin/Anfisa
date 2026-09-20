/**
 * Deterministic quality model (PIPE-004, §8).
 *
 * The MVP does not imitate a proprietary decoder. It needs a stable,
 * explainable response to changed geometry: for each candidate label we
 * compute normalized components in [0,1] and multiply them:
 *
 *   Q = visibility · coverage · ppm · angle · blur · focus
 *       · contrast · glare · damage
 *
 * Hard gates reject impossible conditions outright. A seeded probability is
 * applied ONLY near the quality boundary (the last `boundaryBand` of the
 * [0,1] range), so results are deterministic for a given seed + label +
 * frame while still showing realistic pass/fail jitter at the edge.
 *
 * Every threshold comes from the editable `QualityThresholds` block — all
 * values are labelled simulation assumptions, not physical constants.
 */

import type { AreaScanCameraConfig, ReasonCode } from '../domain/types';
import type { QualityThresholds } from '../domain/config';
import { exposureMetrics } from '../capture/imageFormation';
import { labelReasons, type ReasonInput } from './reasons';

export interface QualityResult {
  /** Normalized components in [0,1] (includes `visibility`). */
  components: Record<string, number>;
  /** Product of all components — the raw quality score in [0,1]. */
  quality: number;
  /** Hard-gate failures (empty = no impossible condition). */
  gateFailures: string[];
  /** Canonical reason list for the observed conditions (PIPE-005). */
  reasons: ReasonCode[];
  /** Final synthetic decode decision (gates + seeded boundary). */
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Contrast proxy (exposure-driven, §8.2 "low light")
// ---------------------------------------------------------------------------

/**
 * Exposure-driven contrast proxy, 0..1 (demo assumption): 1 at nominal
 * brightness; underexposure and highlight clipping each reduce local
 * barcode contrast. Same brightness model the frame renderer uses,
 * so the visible frame and the measured quality agree.
 */
export function contrastProxy(
  rig: AreaScanCameraConfig,
  illuminationFactor = 1,
): number {
  const e = exposureMetrics(rig, illuminationFactor);
  return Math.min(1, Math.max(0, 1 - e.underexposureFraction - e.clipFraction));
}

// ---------------------------------------------------------------------------
// Component ramps
// ---------------------------------------------------------------------------

/** Clamp to [0,1]. */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Higher-is-better: 0 at `lo`, 1 at `hi`, linear between, clamped. */
function rampHigh(x: number, lo: number, hi: number): number {
  if (hi <= lo) return x >= hi ? 1 : 0;
  return clamp01((x - lo) / (hi - lo));
}

/** Lower-is-better: 1 at `lo`, 0 at `hi`, linear between, clamped. */
function rampLow(x: number, lo: number, hi: number): number {
  if (hi <= lo) return x <= lo ? 1 : 0;
  return clamp01((hi - x) / (hi - lo));
}

// ---------------------------------------------------------------------------
// Seeded boundary roll
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a → deterministic uint. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic uniform in [0,1) from a string key. */
function seededUnit(key: string): number {
  // Avalanche (splitmix-style finalizer) so nearby keys decorrelate.
  let z = (fnv1a(key) + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) ^ 0xc2b2ae35;
  z = Math.imul(z ^ (z >>> 13), 0x27d4eb2f) ^ 0x165667b1;
  return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
}

/**
 * Pass probability from raw quality Q. Below `1 - boundaryBand` → 0,
 * at/above 1 → 1, linear in between. The seeded roll is applied only in
 * that band (i.e. "near the boundary").
 */
function passProbability(Q: number, band: number): number {
  if (band <= 0) return Q >= 1 ? 1 : 0;
  return clamp01((Q - (1 - band)) / band);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Evaluate a candidate label's quality.
 *
 * @param input      measured conditions (see ReasonInput)
 * @param t          editable quality thresholds (§8)
 * @param seedKey    deterministic key, e.g. `${runId}:${cameraId}:${labelId}:${frameId}`
 */
export function evaluateQuality(
  input: ReasonInput,
  t: QualityThresholds,
  seedKey: string,
): QualityResult {
  const visibility =
    input.inFov && input.frontFacing && !input.occluded && !input.cameraFault
      ? 1
      : 0;
  const coverage = rampHigh(input.coverage, t.coverageMin, 1);
  const ppm = rampHigh(input.ppm, t.ppmMin, t.ppmTarget);
  const angle = rampLow(input.incidenceDeg, t.incidenceDegTarget, t.incidenceDegMax);
  const blur = rampLow(input.blurPx, t.blurPxTarget, t.blurPxMax);
  const focus = rampLow(input.focusPx, t.focusPxTarget, t.focusPxMax);
  const contrast = rampHigh(input.contrast, t.contrastFloor, t.contrastMin);
  const glare = rampLow(input.glare, t.glareMin, t.glareMax);
  const damage = clamp01(1 - input.damage);

  const components: Record<string, number> = {
    visibility,
    coverage,
    ppm,
    angle,
    blur,
    focus,
    contrast,
    glare,
    damage,
  };

  const quality =
    visibility *
    coverage *
    ppm *
    angle *
    blur *
    focus *
    contrast *
    glare *
    damage;

  // --- Hard gates (impossible conditions) ---
  const gateFailures: string[] = [];
  if (!input.inFov || input.coverage < t.coverageMin) gateFailures.push('OUT_OF_FOV');
  if (!input.frontFacing) gateFailures.push('BACK_FACING');
  if (input.occluded) gateFailures.push('OCCLUDED');
  if (input.ppm < t.ppmMin) gateFailures.push('LOW_PPM');
  if (input.incidenceDeg > t.incidenceDegMax) gateFailures.push('HIGH_ANGLE');
  if (input.blurPx > t.blurPxMax) gateFailures.push('MOTION_BLUR');
  if (input.focusPx > t.focusPxMax) gateFailures.push('OUT_OF_FOCUS');
  if (input.contrast < t.contrastFloor) gateFailures.push('LOW_CONTRAST');
  if (input.glare > t.glareMax) gateFailures.push('GLARE');
  if (input.damage > t.damageMax) gateFailures.push('DAMAGE');
  if (input.cameraFault) gateFailures.push('CAMERA_FAULT');

  // --- Decision: gates win; otherwise seeded boundary roll ---
  let passed: boolean;
  if (gateFailures.length > 0) {
    passed = false;
  } else {
    const p = passProbability(quality, t.boundaryBand);
    passed = p >= 1 || seededUnit(seedKey) < p;
  }

  return {
    components,
    quality,
    gateFailures,
    reasons: labelReasons(input, t),
    passed,
  };
}

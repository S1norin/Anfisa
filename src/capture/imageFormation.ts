/**
 * Image formation + artifact model (IMG-005..IMG-012).
 *
 * One pure function per physical effect, plus `frameArtifacts()` which
 * assembles everything a rendered frame needs:
 *
 *   - `analytic` values — what the quality model (issue #8) reads.
 *     NEVER scaled by `artifactAmplification` or preview mode (IMG-003).
 *   - `visual` parameters — what the GLSL preview pass consumes. These
 *     respect the per-effect toggles (IMG-012) and the amplification
 *     control, and collapse to neutral in CLEAN preview mode.
 *
 * Every value is deterministic: given the same rig, parcels, speed and
 * frame id, the same frame is produced (reproducible capture pipeline,
 * NFR-002).
 */

import { sensorIntrinsics, toCameraSpace } from '../domain/camera';
import type { AreaScanCameraConfig, ParcelState } from '../domain/types';
import {
  effectiveExposureS,
  parcelMotionBlurPx,
  travelDirectionImageSpace,
} from '../observation/blur';

export type PreviewMode = 'CLEAN' | 'PHYSICAL' | 'AMPLIFIED';

/** Nominal exposure the brightness model is referenced to (µs). */
export const NOMINAL_EXPOSURE_US = 75;

// ---------------------------------------------------------------------------
// Exposure (IMG-005)
// ---------------------------------------------------------------------------

export interface ExposureMetrics {
  /** exposureUs / 75 µs. */
  exposureFactor: number;
  /** 2^(gainDb/10) · illumination.intensity. */
  gainFactor: number;
  /** Overall brightness multiplier (1 = nominal). */
  brightness: number;
  /** Fraction of the dynamic range clipped (analytic, 0..1). */
  clipFraction: number;
  /** Fraction the frame falls short of usable exposure (analytic, 0..1). */
  underexposureFraction: number;
  overexposed: boolean;
  underexposed: boolean;
}

/**
 * Brightness model (demo approximation, documented per IMG-005):
 * brightness = (exposure/75µs) · 2^(gain/10 dB) · intensity.
 * Above 1.25 the highlights start clipping, saturating at 4.0;
 * below 0.5 the frame is underexposed, fully at 0.
 */
export function exposureMetrics(
  rig: AreaScanCameraConfig,
  illuminationFactor = 1,
): ExposureMetrics {
  const exposureFactor = rig.acquisition.exposureUs / NOMINAL_EXPOSURE_US;
  const gainFactor =
    Math.pow(2, rig.acquisition.gainDb / 10) *
    rig.illumination.intensity *
    illuminationFactor;
  const brightness = exposureFactor * gainFactor;
  const clipFraction =
    brightness > 1.25 ? Math.min(1, (brightness - 1.25) / 2.75) : 0;
  const underexposureFraction =
    brightness < 0.5 ? Math.min(1, (0.5 - brightness) / 0.5) : 0;
  return {
    exposureFactor,
    gainFactor,
    brightness,
    clipFraction,
    underexposureFraction,
    overexposed: clipFraction > 0,
    underexposed: underexposureFraction > 0,
  };
}

// ---------------------------------------------------------------------------
// Focus / depth of field (IMG-007)
// ---------------------------------------------------------------------------

/**
 * Thin-lens defocus: a lens focused at `focusDistanceMm` renders an object
 * at `distanceMm` with a circle of confusion on the sensor.
 * defocusPx ≈ A·|i' − i| / i' / pixelPitch, i = image distance.
 * Zero exactly at the focus distance; ~0 for near-infinity objects of a
 * 16 mm lens focused at meter scale (that is the DOF behaviour).
 */
/** Defocus with the rig's own focal length (derived from intrinsics). */
export function defocusPx(rig: AreaScanCameraConfig, distanceMm: number): number {
  return defocusPxWithFocal(rig, distanceMm, rigOpticalFocalMm(rig));
}

/** Same as `defocusPx` but with an explicit focal length (testable). */
export function defocusPxWithFocal(
  rig: AreaScanCameraConfig,
  distanceMm: number,
  focalMm: number,
): number {
  const s = rig.acquisition.focusDistanceMm;
  if (distanceMm <= focalMm || s <= focalMm) return 0;
  const imageAt = (obj: number) => 1 / (1 / focalMm - 1 / obj);
  const i = imageAt(s);
  const ip = imageAt(distanceMm);
  const pupilMm = focalMm / rig.optics.apertureProxy;
  const cocMm = (pupilMm * Math.abs(ip - i)) / Math.abs(ip);
  const pitch =
    rig.sensor.filmGaugeMm / rig.sensor.widthPx; // mm per pixel (film gauge)
  return cocMm / pitch;
}

// ---------------------------------------------------------------------------
// Glare / polarization (IMG-008)
// ---------------------------------------------------------------------------

/**
 * Specular glare index for a parcel, 0..1 (analytic, PBR approximation):
 * for taped parcels, a narrow highlight on the top-face tape strip when
 * the camera sits in the specular lobe. Polarized illumination suppresses
 * the highlight (≈ ×0.5, documented approximation).
 */
export function parcelGlareIndex(
  rig: AreaScanCameraConfig,
  parcel: ParcelState,
): number {
  if (!parcel.spec.tape) return 0;
  const [cx, cy, cz] = parcelCentreWorldMm(parcel);
  const topPoint: [number, number, number] = [cx, cy + parcel.spec.heightMm / 2, cz];
  const n: [number, number, number] = [0, 1, 0];
  const light: [number, number, number] = [0, -1, 0]; // top lights point down
  // R = 2(n·l)n − l
  const ndl = 2 * (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
  const r: [number, number, number] = [
    ndl * n[0] - light[0],
    ndl * n[1] - light[1],
    ndl * n[2] - light[2],
  ];
  const v: [number, number, number] = [
    rig.pose.positionMm[0] - topPoint[0],
    rig.pose.positionMm[1] - topPoint[1],
    rig.pose.positionMm[2] - topPoint[2],
  ];
  const vl = Math.hypot(v[0], v[1], v[2]) || 1;
  const dot = (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / vl;
  if (dot <= 0) return 0;
  // Narrow highlight, exponent 8: only readers near the mirror angle see it.
  const glare = Math.pow(dot, 8);
  const suppression = rig.illumination.polarized ? 0.5 : 1;
  return Math.min(1, glare * suppression);
}

export function parcelCentreWorldMm(p: ParcelState): [number, number, number] {
  const s = p.spec;
  return [s.lateralOffsetMm, s.heightMm / 2, p.frontZMm - s.lengthMm / 2];
}

/** Strongest glare among the candidate parcels of a frame. */
export function frameGlareIndex(
  rig: AreaScanCameraConfig,
  parcels: ParcelState[],
): number {
  let max = 0;
  for (const p of parcels) max = Math.max(max, parcelGlareIndex(rig, p));
  return max;
}

// ---------------------------------------------------------------------------
// Flicker (IMG-009)
// ---------------------------------------------------------------------------

/**
 * Deterministic fluorescent-flicker modulation, 0..1 (multiplier on
 * illumination). depth=0 → constant 1. A preset scenario drives
 * hz/depth (t14).
 */
export function flickerFactor(
  simTimeMs: number,
  flickerHz: number,
  depth: number,
): number {
  if (flickerHz <= 0 || depth <= 0) return 1;
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (flickerHz * simTimeMs) / 1000);
  return 1 - depth * wave;
}

// ---------------------------------------------------------------------------
// Noise (IMG-006)
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a hash — deterministic per-frame noise seed. */
export function hashFrameSeed(frameId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < frameId.length; i++) {
    h ^= frameId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Assembled frame artifacts
// ---------------------------------------------------------------------------

export interface FrameArtifacts {
  analytic: {
    motionBlurPx: number;
    rollingSkewFraction: number;
    defocusPx: number;
    exposure: ExposureMetrics;
    glareIndex: number;
    shotNoise: number;
    readNoise: number;
    compression: number;
    /** Max print damage across candidate labels (0 = all clean). */
    damageMax: number;
  };
  visual: {
    motionDir: [number, number];
    motionPx: number;
    motionSamples: number;
    rollingSkew: number;
    defocusPx: number;
    brightness: number;
    clipFraction: number;
    noiseAmp: number;
    noiseSeed: number;
    compression: number;
    glare: number;
    vignette: number;
    distortion: number;
  };
}

/**
 * Nearest candidate parcel drives per-parcel metrics (motion blur, defocus,
 * glare); with no candidates the frame shows an empty belt (no parcel
 * artifacts, exposure/noise/lens still apply).
 */
function nearestParcel(
  rig: AreaScanCameraConfig,
  parcels: ParcelState[],
): ParcelState | null {
  if (parcels.length === 0) return null;
  let best: ParcelState | null = null;
  let bestD = Infinity;
  for (const p of parcels) {
    const rel: [number, number, number] = [
      p.spec.lateralOffsetMm + 0 - rig.pose.positionMm[0],
      p.spec.heightMm / 2 - rig.pose.positionMm[1],
      p.frontZMm - p.spec.lengthMm / 2 - rig.pose.positionMm[2],
    ];
    const cam = toCameraSpace(rel, rig);
    if (cam[2] > 0 && cam[2] < bestD) {
      bestD = cam[2];
      best = p;
    }
  }
  return best;
}

/**
 * Assembles analytic + visual artifact values for one rendered frame.
 *
 * @param rig           camera configuration
 * @param candidates    parcels in the trigger zone at capture time
 * @param speedMmPerSec belt speed at capture
 * @param frameId       capture frame id (deterministic noise seed)
 * @param previewMode   CLEAN | PHYSICAL | AMPLIFIED (visual only)
 * @param illuminationFactor per-frame light multiplier (flicker), 1 = steady
 */
export function frameArtifacts(
  rig: AreaScanCameraConfig,
  candidates: ParcelState[],
  speedMmPerSec: number,
  frameId: string,
  previewMode: PreviewMode = 'PHYSICAL',
  illuminationFactor = 1,
): FrameArtifacts {
  const fx = sensorIntrinsics(rig.sensor).fx;
  const nearest = nearestParcel(rig, candidates);

  // --- analytic (always full, never amplified) ---
  const motionBlurPx = nearest
    ? parcelMotionBlurPx(rig, nearest, speedMmPerSec)
    : 0;
  const readoutS =
    rig.acquisition.shutter === 'ROLLING'
      ? rig.acquisition.rollingReadoutUs * 1e-6
      : 0;
  const distanceMm = nearest
    ? Math.max(1, Math.hypot(
        nearest.spec.lateralOffsetMm - rig.pose.positionMm[0],
        nearest.spec.heightMm / 2 - rig.pose.positionMm[1],
        nearest.frontZMm - nearest.spec.lengthMm / 2 - rig.pose.positionMm[2],
      ))
    : 0;
  const defocus = nearest
    ? defocusPxWithFocal(rig, distanceMm, rigOpticalFocalMm(rig))
    : 0;
  const exposure = exposureMetrics(rig, illuminationFactor);
  const glare = frameGlareIndex(rig, candidates);
  let damageMax = 0;
  for (const p of candidates)
    for (const l of p.spec.labels) damageMax = Math.max(damageMax, l.damage);

  const analyticRollingSkew =
    readoutS > 0 && nearest
      ? (fx * speedMmPerSec * readoutS) / Math.max(1, distanceMm) / rig.sensor.heightPx
      : 0;

  // --- visual (toggles + amplification + preview mode) ---
  const amp =
    previewMode === 'AMPLIFIED'
      ? rig.imageEffects.artifactAmplification
      : 1;
  const on = (key: keyof AreaScanCameraConfig['imageEffects']['toggles']) =>
    previewMode === 'CLEAN' ? false : rig.imageEffects.toggles[key];

  const blurOn = on('motionBlur') && rig.imageEffects.motionBlur !== 'OFF';
  const [dirX, dirY] = travelDirectionImageSpace(rig);
  const motionSamples =
    rig.imageEffects.motionBlur === 'TEMPORAL_ACCUMULATION'
      ? rig.imageEffects.temporalSamples
      : 8;

  return {
    analytic: {
      motionBlurPx,
      rollingSkewFraction: analyticRollingSkew,
      defocusPx: defocus,
      exposure,
      glareIndex: glare,
      shotNoise: rig.imageEffects.shotNoise,
      readNoise: rig.imageEffects.readNoise,
      compression: rig.imageEffects.compression,
      damageMax,
    },
    visual: {
      motionDir: blurOn ? [dirX, dirY] : [0, 0],
      motionPx: blurOn ? motionBlurPx * amp : 0,
      motionSamples: blurOn ? motionSamples : 1,
      rollingSkew: on('motionBlur') ? analyticRollingSkew * amp : 0,
      defocusPx: on('focus') ? defocus * amp : 0,
      brightness: on('exposure') ? exposure.brightness : 1,
      clipFraction: on('exposure') ? exposure.clipFraction : 0,
      noiseAmp: on('noise')
        ? (rig.imageEffects.shotNoise + rig.imageEffects.readNoise) * amp
        : 0,
      noiseSeed: hashFrameSeed(frameId),
      compression: on('compression')
        ? rig.imageEffects.compression * amp
        : 0,
      glare: on('glare') ? glare * amp : 0,
      vignette: on('lens') ? rig.optics.vignetting : 0,
      distortion: on('lens') ? rig.optics.radialDistortion[0] : 0,
    },
  };
}

/** Effective exposure window in seconds (re-exported for the quality model). */
export function effectiveExposureWindowS(rig: AreaScanCameraConfig): number {
  return effectiveExposureS(rig);
}

/**
 * Optical focal length (mm) of the rig. Acquisition does not carry it —
 * the sensor block does (focalLengthMm lives on cameras config and is
 * baked into the intrinsics); rig-level callers pass it explicitly via
 * `defocusPxWithFocal` when they know it.
 */
export function rigOpticalFocalMm(rig: AreaScanCameraConfig): number {
  // Derive focal from intrinsics + sensor pitch: fx = f / pitch.
  const pitch = rig.sensor.filmGaugeMm / rig.sensor.widthPx;
  return sensorIntrinsics(rig.sensor).fx * pitch;
}


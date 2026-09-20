/**
 * Pure line-scan strip observation (t5, PIPE-004 line-scan extension).
 *
 * Turns a closed line-scan strip (t4 sessions + t3 geometry) into an
 * observation carrying the SHARED quality decision: `evaluateQuality`
 * from ./quality is reused verbatim, so line and area scans share one
 * quality model and one threshold block. No quality thresholds are
 * duplicated in this file (AC-5).
 *
 * This module does NOT decode: `decodable` is a gate decision, and the
 * strip → label decode mapping is t6.
 *
 * Labelled simulation assumptions (model shapes, not thresholds):
 *  - A line rig sees the parcel's full cross-belt width (inFov = true)
 *    and faces on at 0° with fixed focus (incidenceDeg = 0, focusPx = 0).
 *  - Parcel-on-parcel occlusion is not modelled for line strips; the only
 *    occlusion is the solid station deck under BOTTOM strips (the caller
 *    passes `deckOccluded`, mirroring stationDeckOccludesBottom for area
 *    BOTTOM rigs).
 *  - Line-exposure contrast/blur/glare proxies reuse the same physical
 *    families as area capture (exposure deviation, belt motion during the
 *    line exposure, tape reflectance under the line light).
 */

import type {
  Face,
  LineScanCameraConfig,
  ParcelState,
  ReasonCode,
} from '../domain/types';
import type { QualityThresholds } from '../domain/config';
import {
  effectivePpm,
  pixelPitchMm,
  requiredLineRate,
} from '../capture/lineScanGeometry';
import { evaluateQuality, type QualityResult } from './quality';
import type { ReasonInput } from './reasons';

/** Strip state handed over from the t4 line-scan session. */
export interface LineScanStripStatus {
  encoderStartMm: number;
  encoderEndMm: number;
  lineCount: number;
  expectedLineCount: number;
  complete: boolean;
  abortReason?: string;
}

export interface LineScanObservationInput {
  rig: LineScanCameraConfig;
  parcel: ParcelState;
  strip: LineScanStripStatus;
  simTimeMs: number;
  beltSpeedMmPerSec: number;
  /** Solid deck under the parcel's z-interval at the scan plane (BOTTOM). */
  deckOccluded: boolean;
  /** Rig OFFLINE/FAULT at strip closure. */
  cameraFault: boolean;
  thresholds: QualityThresholds;
  seed: number;
}

export interface LineScanStripObservation {
  cameraId: string;
  parcelId: string;
  face: Face;
  simTimeMs: number;
  encoderStartMm: number;
  encoderEndMm: number;
  lineCount: number;
  expectedLineCount: number;
  complete: boolean;
  abortReason?: string;
  /** Travel-direction ppm, encoder-corrected (t3 formula). */
  effectivePpm: number;
  /** Belt-imposed line rate, lines/s (compared against the rig cap). */
  requiredLineRate: number;
  /** Shared-model quality decision, extended with line hard gates. */
  quality: QualityResult;
  /** Canonical reason codes (PIPE-005), extended with line gates. */
  reasons: ReasonCode[];
  /** Decodable: quality passed with no line hard-gate failures. */
  decodable: boolean;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Exposure-driven line contrast proxy, 0..1: 1 at the 25 µs nominal
 * exposure; under- and over-exposure each reduce contrast linearly.
 * (Model shape only — the decision thresholds stay in quality.ts.)
 */
function lineContrastProxy(lineExposureUs: number): number {
  const e = lineExposureUs / 25; // 25 µs nominal (line-scan builder default)
  return clamp01(1 - Math.abs(e - 1));
}

/**
 * Tape reflectance under the line light: 0 without tape; with tape the
 * polarized line light suppresses the mirror highlight, leaving 20% of
 * the light intensity as residual (demo assumption — a straight-top-down
 * camera sees no specular lobe, same geometry as area parcelGlareIndex).
 */
function lineGlareProxy(intensity: number, parcel: ParcelState): number {
  if (!parcel.spec.tape) return 0;
  return clamp01(intensity) * 0.2;
}

/**
 * Observe a closed line-scan strip.
 *
 * Returns `null` when a BOTTOM strip lies entirely over solid deck
 * (nothing observed — mirrors the area-scan bottom occlusion behaviour).
 */
export function observeLineScanStrip(
  input: LineScanObservationInput,
): LineScanStripObservation | null {
  const { rig, parcel, strip } = input;
  if (input.deckOccluded) return null;

  const face: Face = rig.role === 'BOTTOM' ? 'BOTTOM' : 'TOP';
  const { pixelsPerLine, fovWidthMm, encoderStepMmPerLine, lineExposureUs } =
    rig.line;
  const requiredRate = requiredLineRate(input.beltSpeedMmPerSec, encoderStepMmPerLine);
  const underSampled = requiredRate > rig.line.maxLineRateLinesPerSec;
  // xDimensionMm = 1 mm normalizes both axes to per-module density;
  // the encoder span [encoderStartMm, encoderEndMm] is reported in the
  // observation for audit (encoder-corrected travel).
  const ppm = effectivePpm(1, pixelsPerLine, fovWidthMm, encoderStepMmPerLine);
  const blurPx =
    (input.beltSpeedMmPerSec * (lineExposureUs / 1e6)) /
    pixelPitchMm(pixelsPerLine, fovWidthMm);
  const coverage = strip.complete
    ? 1
    : clamp01(strip.lineCount / Math.max(1, strip.expectedLineCount));

  const qi: ReasonInput = {
    inFov: true,
    frontFacing: true,
    occluded: false,
    cameraFault: input.cameraFault,
    coverage,
    ppm,
    incidenceDeg: 0,
    blurPx,
    focusPx: 0,
    contrast: lineContrastProxy(lineExposureUs),
    glare: lineGlareProxy(rig.illumination.intensity, parcel),
    damage: 0,
  };
  const q = evaluateQuality(
    qi,
    input.thresholds,
    `${input.seed}:${rig.id}:linescan:${parcel.parcelId}:${Math.round(strip.encoderStartMm)}`,
  );

  // Line-specific hard gates extend (never weaken) the shared result.
  const gateFailures = [...q.gateFailures];
  if (!strip.complete) gateFailures.push('INCOMPLETE_STRIP');
  if (underSampled) gateFailures.push('LOW_PPM');
  const passed = q.passed && gateFailures.length === 0;
  const reasons = [...q.reasons];
  if (underSampled && !reasons.includes('LOW_PPM')) reasons.push('LOW_PPM');

  return {
    cameraId: rig.id,
    parcelId: parcel.parcelId,
    face,
    simTimeMs: input.simTimeMs,
    encoderStartMm: strip.encoderStartMm,
    encoderEndMm: strip.encoderEndMm,
    lineCount: strip.lineCount,
    expectedLineCount: strip.expectedLineCount,
    complete: strip.complete,
    ...(strip.abortReason !== undefined
      ? { abortReason: strip.abortReason }
      : {}),
    effectivePpm: ppm,
    requiredLineRate: requiredRate,
    quality: { ...q, gateFailures, reasons, passed },
    reasons,
    decodable: passed,
  };
}

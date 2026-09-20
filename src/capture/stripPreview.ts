/**
 * Encoder-mapped strip preview (t9, display-only — NFR-002).
 *
 * Rebuilds a closed line-scan strip as a synthetic RGBA texture where the
 * ROW AXIS IS THE ENCODER AXIS: row i maps to the encoder interval
 * [encoderStartMm + i·step, encoderStartMm + (i+1)·step). Row 0 is the
 * encoder start; rows advance with belt travel.
 *
 * Artifacts reflect the rig's config effect params (`imageEffects`,
 * SIM-004): periodic banding along the encoder axis, per-row encoder
 * mapping jitter, dropped (missing) lines as black rows, and motion smear
 * from belt travel during the line exposure.
 *
 * This is a PURE display path: it consumes only the domain strip (the
 * bounded t4 session-closure payload) plus config. The decode path
 * (feedCapture LINE_STRIP → pipeline) never reads this texture — see
 * lineScanPipeline.test.ts ("decode never reads preview pixels").
 */

import { pixelPitchMm } from './lineScanGeometry';
import type { StripPixels } from './frameBuffer';
import type { LineScanCameraConfig } from '../domain/types';

/** Display columns per line (8192 px/line is overkill for a tile). */
const MAX_DISPLAY_COLS = 320;
/** Banding period in rows along the encoder axis. */
const BAND_PERIOD_ROWS = 12;
/** Banding depth (±fraction of brightness at full strength). */
const BAND_DEPTH = 0.45;
/** Brightness of a not-acquired row (incomplete strip tail). */
const NOT_ACQUIRED = 26;

/** Domain strip from a closed t4 session (structural LineScanStripStatus). */
export interface StripPreviewStrip {
  encoderStartMm: number;
  encoderEndMm: number;
  lineCount: number;
  expectedLineCount: number;
  complete: boolean;
  abortReason?: string;
}

export interface StripPreviewInput {
  rig: LineScanCameraConfig;
  parcelId: string;
  simTimeMs: number;
  strip: StripPreviewStrip;
  /** Belt speed for the motion smear (SIM-004). */
  beltSpeedMmPerSec: number;
  seed: number;
}

/** Display RGBA texture, one row per encoder line (encoder-mapped). */
export type StripTexture = StripPixels;

/** fnv-1a 32-bit string hash (deterministic display keying). */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic uniform in [0, 1) from a string key. */
function unit(key: string): number {
  return fnv1a(key) / 4294967296;
}

/**
 * Synthetic parcel-face pattern in band-normalized coordinates: a parcel
 * surface (0.72) with a deterministic barcode band (0.3–0.7) of vertical
 * bars. Content is constant along the encoder axis — the label spans the
 * whole parcel — so with zero effects every row is identical.
 */
function barValue(x: number): number {
  if (x < 0.3 || x > 0.7) return 0.72;
  const n = 24; // bar periods across the band
  const bar = Math.floor(((x - 0.3) / 0.4) * n) % 2;
  return bar === 0 ? 0.12 : 0.95;
}

/** In-place box blur of radius `radius` (prefix-sum: O(n) in `v.length`). */
function boxBlur(v: Float32Array, radius: number): void {
  const n = v.length;
  if (radius <= 0) return;
  const prefix = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + v[i];
  for (let i = 0; i < n; i++) {
    const left = Math.max(0, i - radius);
    const right = Math.min(n - 1, i + radius);
    v[i] = (prefix[right + 1] - prefix[left]) / (right - left + 1);
  }
}

/**
 * Build the display-only strip texture for a closed line-scan strip.
 * Deterministic for a given (seed, rig, parcel, encoder interval).
 */
export function buildStripTexture(input: StripPreviewInput): StripTexture {
  const { rig, parcelId, strip, seed } = input;
  const { pixelsPerLine, sensorWidthMm, lineExposureUs } = rig.line;
  const { jitter, missingLineChance, banding } = rig.imageEffects;

  const cols = Math.max(1, Math.min(pixelsPerLine, MAX_DISPLAY_COLS));
  // One row per encoder line across [start, end) — the encoder mapping.
  const rows = Math.max(1, strip.expectedLineCount);

  // Row order never matters: every per-row roll is keyed by row index.
  const key = `${seed}:${rig.id}:${parcelId}:${Math.round(strip.encoderStartMm)}:${Math.round(strip.encoderEndMm)}`;
  const phase = unit(`${key}:phase`) * 0.2;

  // Motion smear: belt travel during the line exposure (SIM-004),
  // rescaled from sensor pixels to display columns.
  const blurPx =
    (input.beltSpeedMmPerSec * (lineExposureUs / 1e6)) /
    pixelPitchMm(pixelsPerLine, sensorWidthMm);
  const radius = Math.min(cols, Math.round((blurPx * pixelsPerLine) / cols));

  const data = new Uint8ClampedArray(cols * rows * 4);
  const missingLineRows: number[] = [];
  const rowVals = new Float32Array(cols);

  for (let r = 0; r < rows; r++) {
    const off = r * cols * 4;
    const missing = unit(`${key}:${r}:miss`) < missingLineChance;
    if (missing) {
      missingLineRows.push(r);
      // Dropped line: black row (alpha 255).
      for (let c = 0; c < cols; c++) data[off + c * 4 + 3] = 255;
      continue;
    }
    if (r >= strip.lineCount) {
      // Beyond the acquired line count (incomplete strip): dark tail.
      for (let c = 0; c < cols; c++) {
        const i = off + c * 4;
        data[i] = NOT_ACQUIRED;
        data[i + 1] = NOT_ACQUIRED;
        data[i + 2] = NOT_ACQUIRED;
        data[i + 3] = 255;
      }
      continue;
    }
    const band =
      1 + banding * BAND_DEPTH * Math.sin((2 * Math.PI * r) / BAND_PERIOD_ROWS);
    const shift = jitter * (unit(`${key}:${r}:jit`) - 0.5) * 0.5;
    for (let c = 0; c < cols; c++) {
      rowVals[c] = barValue(c / cols + phase + shift) * band;
    }
    boxBlur(rowVals, radius);
    for (let c = 0; c < cols; c++) {
      const v = Math.round(Math.min(1, Math.max(0, rowVals[c])) * 255);
      const i = off + c * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }

  return {
    cameraId: rig.id,
    parcelId,
    simTimeMs: input.simTimeMs,
    widthPx: cols,
    heightPx: rows,
    data,
    missingLineRows,
    lineCount: strip.lineCount,
    expectedLineCount: strip.expectedLineCount,
    complete: strip.complete,
    encoderStartMm: strip.encoderStartMm,
    encoderEndMm: strip.encoderEndMm,
  };
}

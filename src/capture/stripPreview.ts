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
  const { pixelsPerLine, fovWidthMm, lineExposureUs } = rig.line;
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
    pixelPitchMm(pixelsPerLine, fovWidthMm);
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

// ---------------------------------------------------------------------------
// Guided-replay line-scan strip (t3-1) — faithful to the Python asset
// generator (scripts/gen_hiw_assets.py: render_top_strip). The HIW strip
// rows must correspond to the selected parcel face + label: flat kraft,
// tape seams, white label, Code 128 B barcode (ISO 15417) along the
// travel axis. Pure JS (no canvas API) so vitest can pixel-compare the
// composite against the generated raw.png.
// ---------------------------------------------------------------------------

/** ISO 15417 Code 128 pattern table (107 values), verbatim from the generator. */
const CODE128_PATTERNS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [2, 1, 2, 2, 2, 2],
  [2, 2, 2, 1, 2, 2],
  [2, 2, 2, 2, 2, 1],
  [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2],
  [1, 3, 1, 2, 2, 2],
  [1, 2, 2, 2, 1, 3],
  [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2],
  [2, 2, 1, 2, 1, 3],
  [2, 2, 1, 3, 1, 2],
  [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2],
  [1, 2, 2, 1, 3, 2],
  [1, 2, 2, 2, 3, 1],
  [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2],
  [1, 2, 3, 2, 2, 1],
  [2, 2, 3, 2, 1, 1],
  [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1],
  [2, 1, 3, 2, 1, 2],
  [2, 2, 3, 1, 1, 2],
  [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2],
  [3, 2, 1, 1, 2, 2],
  [3, 2, 1, 2, 2, 1],
  [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2],
  [3, 2, 2, 2, 1, 1],
  [2, 1, 2, 1, 2, 3],
  [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1],
  [1, 1, 1, 3, 2, 3],
  [1, 3, 1, 1, 2, 3],
  [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3],
  [1, 3, 2, 1, 1, 3],
  [1, 3, 2, 3, 1, 1],
  [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3],
  [2, 3, 1, 3, 1, 1],
  [1, 1, 2, 1, 3, 3],
  [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1],
  [1, 1, 3, 1, 2, 3],
  [1, 1, 3, 3, 2, 1],
  [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1],
  [2, 1, 1, 3, 3, 1],
  [2, 3, 1, 1, 3, 1],
  [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1],
  [2, 1, 3, 1, 3, 1],
  [3, 1, 1, 1, 2, 3],
  [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1],
  [3, 1, 2, 1, 1, 3],
  [3, 1, 2, 3, 1, 1],
  [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1],
  [2, 2, 1, 4, 1, 1],
  [4, 3, 1, 1, 1, 1],
  [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2],
  [1, 2, 1, 1, 2, 4],
  [1, 2, 1, 4, 2, 1],
  [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1],
  [1, 1, 2, 2, 1, 4],
  [1, 1, 2, 4, 1, 2],
  [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1],
  [1, 4, 2, 1, 1, 2],
  [1, 4, 2, 2, 1, 1],
  [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4],
  [4, 1, 3, 1, 1, 1],
  [2, 4, 1, 1, 1, 2],
  [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2],
  [1, 2, 1, 1, 4, 2],
  [1, 2, 1, 2, 4, 1],
  [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2],
  [1, 2, 4, 2, 1, 1],
  [4, 1, 1, 2, 1, 2],
  [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1],
  [2, 1, 2, 1, 4, 1],
  [2, 1, 4, 1, 2, 1],
  [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3],
  [1, 1, 1, 3, 4, 1],
  [1, 3, 1, 1, 4, 1],
  [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1],
  [4, 1, 1, 1, 1, 3],
  [4, 1, 1, 3, 1, 1],
  [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1],
  [3, 1, 1, 1, 4, 1],
  [4, 1, 1, 1, 3, 1],
  [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4],
  [2, 1, 1, 2, 3, 2],
  [2, 3, 3, 1, 1, 1],
];const CODE128_START_B = 104;
const CODE128_STOP = [2, 3, 3, 1, 1, 1, 2] as const;

/** Bar/space element widths for an ISO Code 128 B symbol. */
export function code128Elements(payload: string): number[] {
  const data = [...payload].map((c) => {
    const v = c.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Code 128 B: unsupported char '${c}'`);
    return v;
  });
  const csum = (CODE128_START_B + data.reduce((a, b) => a + b, 0)) % 103;
  const els: number[] = [];
  for (const v of [CODE128_START_B, ...data, csum]) {
    els.push(...CODE128_PATTERNS[v]);
  }
  els.push(...CODE128_STOP);
  return els;
}

/**
 * Strip geometry, mirrored from scripts/gen_hiw_assets.py
 * (STRIP_W/STRIP_H, label rect, tape seams, barcode scale).
 */
export const HIW_STRIP = {
  widthPx: 570,
  rows: 560,
  label: { x0: 85, x1: 485, y0: 70, y1: 470 },
  tapeSeamY: [120, 440] as readonly number[],
  barcodeModulePx: 2,
  quietModules: 10,
  barcodeRowsModules: 25,
} as const;

// Grayscale equivalents of the generator's BGR constants (BT.601 luma).
const KRAFT_GRAY = Math.round(0.114 * 106 + 0.587 * 138 + 0.299 * 168); // 143
const TAPE_GRAY = Math.round(0.114 * 88 + 0.587 * 108 + 0.299 * 128); // 112
const LABEL_GRAY = 250;
/** Combined sigma of the generator's two noise passes (luma-projected). */
const KRAFT_NOISE_SIGMA = 1.65;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianNoise(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface HiwLineStrip {
  widthPx: number;
  rows: number;
  /** Grayscale rows in encoder order (row 0 = start of travel). */
  gray: Uint8ClampedArray;
  labelRect: { x0: number; x1: number; y0: number; y1: number };
  /** Barcode placement in strip pixels (after the generator's 90° rotation). */
  barcode: { x0: number; y0: number; w: number; h: number };
}

/**
 * Build the line-scan strip rows for a fixture payload, matching the
 * generator's raw.png within noise tolerance. Deterministic in (payload, seed).
 */
export function buildHiwLineStripRows(
  payload: string,
  seed = 42,
): HiwLineStrip {
  const { widthPx, rows, label } = HIW_STRIP;
  const gray = new Uint8ClampedArray(widthPx * rows);

  const rand = mulberry32(seed);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = KRAFT_GRAY + gaussianNoise(rand) * KRAFT_NOISE_SIGMA;
  }
  for (const y of HIW_STRIP.tapeSeamY) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let x = 0; x < widthPx; x++) {
        gray[(y + dy) * widthPx + x] = TAPE_GRAY;
      }
    }
  }
  for (let y = label.y0; y <= label.y1; y++) {
    for (let x = label.x0; x <= label.x1; x++) {
      gray[y * widthPx + x] = LABEL_GRAY;
    }
  }

  // Barcode (rotated 90° CCW like the generator's np.rot90(bc, k=1)).
  const els = code128Elements(payload);
  const m = HIW_STRIP.barcodeModulePx;
  const totalModules = HIW_STRIP.quietModules * 2 + els.reduce((a, b) => a + b, 0);
  const bcW = totalModules * m; // modules run along travel (y) after rotation
  const bcH = HIW_STRIP.barcodeRowsModules * m; // 50 px cross-belt
  const moduleIsBar: boolean[] = new Array<boolean>(totalModules).fill(false);
  {
    let mod = HIW_STRIP.quietModules;
    els.forEach((w, i) => {
      if (i % 2 === 0) {
        for (let k = 0; k < w; k++) moduleIsBar[mod + k] = true;
      }
      mod += w;
    });
  }
  const x0 = Math.floor((widthPx - bcH) / 2);
  const y0 = label.y0 + Math.floor((label.y1 - label.y0 - bcW) / 2);
  for (let i = 0; i < bcW; i++) {
    const y = y0 + i;
    // rot90(k=1): out[i][j] = in[j][bcW - 1 - i]
    const col = bcW - 1 - i;
    const module = Math.floor(col / m);
    const bar = moduleIsBar[module] ? 0 : 255;
    for (let j = 0; j < bcH; j++) {
      gray[y * widthPx + (x0 + j)] = bar;
    }
  }

  return {
    widthPx,
    rows,
    gray,
    labelRect: { ...label },
    barcode: { x0, y0, w: bcH, h: bcW },
  };
}

export interface CompositeHiwStrip {
  widthPx: number;
  /** Rows actually present in the composite (encoder order, from row 0). */
  rowCount: number;
  rgba: Uint8ClampedArray;
}

/**
 * Bare-kraft strip rows (bottom face — no label, no barcode): kraft
 * background + the same deterministic noise field as the top strip.
 * The story parcel's bottom face is unlabelled kraft (labels: TOP/FRONT
 * only), so the bottom line scan sees exactly this.
 */
export function buildHiwKraftStripRows(seed = 42): HiwLineStrip {
  const { widthPx, rows } = HIW_STRIP;
  const gray = new Uint8ClampedArray(widthPx * rows);
  const rand = mulberry32(seed);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = KRAFT_GRAY + gaussianNoise(rand) * KRAFT_NOISE_SIGMA;
  }
  return {
    widthPx,
    rows,
    gray,
    labelRect: { x0: 0, x1: 0, y0: 0, y1: 0 },
    barcode: { x0: 0, y0: 0, w: 0, h: 0 },
  };
}

/**
 * Composite strip rows (encoder order) into an RGBA buffer. `visibleRows`
 * supports progressive display (t3-2): rows arrive as the encoder advances.
 */
export function compositeHiwStripRows(
  strip: HiwLineStrip,
  visibleRows?: number,
): CompositeHiwStrip {
  return compositeHiwStripRange(strip, 0, visibleRows ?? strip.rows);
}

/**
 * Composite a ROW RANGE of a strip (encoder order) into an RGBA buffer —
 * the bottom strip (t3-2) shows only the rows where the optical gap
 * exposes the underside.
 */
export function compositeHiwStripRange(
  strip: HiwLineStrip,
  fromRow: number,
  rowCount: number,
): CompositeHiwStrip {
  const from = Math.max(0, Math.min(strip.rows, Math.floor(fromRow)));
  const count = Math.max(
    0,
    Math.min(strip.rows - from, Math.floor(rowCount)),
  );
  const rgba = new Uint8ClampedArray(strip.widthPx * count * 4);
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < strip.widthPx; x++) {
      const g = strip.gray[(from + y) * strip.widthPx + x];
      const o = (y * strip.widthPx + x) * 4;
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = 255;
    }
  }
  return { widthPx: strip.widthPx, rowCount: count, rgba };
}

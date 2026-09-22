/**
 * Synthetic live-camera source (t7-3).
 *
 * The live module has NO physical camera support (t7-2/t7-3 non-goal):
 * each selectable sensor emits deterministic synthetic frames. Frames
 * carry a REAL Code 128 symbol (bwip-derived element table from
 * stripPreview, the same one the offline generator renders), so the
 * service detector, rectification, and the browser ZXing path all run
 * on genuine pixels. Specific cameras are scripted for the no-read
 * story:
 *   - cam-side-3: glare wash over the label   -> QUALITY:GLARE
 *   - cam-side-6: faint label (below threshold) -> QUALITY:LOW_CONTRAST
 *
 * Everything is a pure function of (camera, payload, capture index) —
 * no Math.random, no Date.now.
 */

import { code128Elements, HIW_STRIP } from '../../../capture/stripPreview';
import type {
  LiveCaptureInput,
  LiveSourceKind,
} from '../../../live-processing/contracts';
import type { PixelFrame } from '../../../pipeline/pixelDecoder';
import type { SideCamId } from '../step5SideCameras';

export type LiveCameraId = 'ls-top' | 'ls-bottom' | SideCamId;

export const LIVE_CAMERAS: { id: LiveCameraId; label: string; kind: LiveSourceKind }[] = [
  { id: 'ls-top', label: 'top line scan', kind: 'LINE_STRIP' },
  { id: 'ls-bottom', label: 'bottom line scan', kind: 'LINE_STRIP' },
  { id: 'cam-side-1', label: 'side cam 1', kind: 'AREA_FRAME' },
  { id: 'cam-side-2', label: 'side cam 2', kind: 'AREA_FRAME' },
  { id: 'cam-side-3', label: 'side cam 3 (glare)', kind: 'AREA_FRAME' },
  { id: 'cam-side-4', label: 'side cam 4', kind: 'AREA_FRAME' },
  { id: 'cam-side-5', label: 'side cam 5', kind: 'AREA_FRAME' },
  { id: 'cam-side-6', label: 'side cam 6 (faint)', kind: 'AREA_FRAME' },
];

export function liveCameraLabel(id: LiveCameraId): string {
  return LIVE_CAMERAS.find((c) => c.id === id)?.label ?? id;
}

export function liveCameraKind(id: LiveCameraId): LiveSourceKind {
  return LIVE_CAMERAS.find((c) => c.id === id)?.kind ?? 'AREA_FRAME';
}

/** Deterministic per-capture jitter in [0, 1) — LCG, no Math.random. */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function cameraSeed(cameraId: LiveCameraId): number {
  let h = 2166136261;
  for (let i = 0; i < cameraId.length; i++) {
    h ^= cameraId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const KRAFT: [number, number, number] = [132, 150, 168]; // BGR(168,150,132)

function putPixel(f: PixelFrame, x: number, y: number, rgb: [number, number, number]): void {
  const i = (y * f.widthPx + x) * 4;
  f.data[i] = rgb[0];
  f.data[i + 1] = rgb[1];
  f.data[i + 2] = rgb[2];
  f.data[i + 3] = 255;
}

function fillRect(
  f: PixelFrame,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
): void {
  for (let y = Math.max(0, y0); y < Math.min(f.heightPx, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(f.widthPx, x1); x++) {
      putPixel(f, x, y, rgb);
    }
  }
}

/**
 * Draw a Code 128 B symbol (element table from stripPreview — the
 * bwip-derived one) as a bar band at (ox, oy), module size `modulePx`.
 * Returns the bar-band bbox.
 */
function drawCode128(
  f: PixelFrame,
  payload: string,
  ox: number,
  oy: number,
  modulePx: number,
): { x: number; y: number; w: number; h: number } {
  const els = code128Elements(payload);
  const totalModules = els.reduce((a, b) => a + b, 0);
  const barH = Math.min(60, Math.floor(f.heightPx / 6));
  let x = Math.round(ox);
  const y0 = Math.round(oy);
  for (let i = 0; i < els.length; i++) {
    const wPx = els[i] * modulePx;
    if (i % 2 === 0) fillRect(f, x, y0, x + wPx, y0 + barH, [0, 0, 0]);
    x += wPx;
  }
  return { x: ox, y: y0, w: totalModules * modulePx, h: barH };
}

const AREA_W = 960;
const AREA_H = 640;

/** Per-azimuth label placement for the six side cameras. */
const SIDE_LAYOUT: Record<SideCamId, { dx: number; dy: number; scale: number }> = {
  'cam-side-1': { dx: 0, dy: 0, scale: 1.0 },
  'cam-side-2': { dx: 120, dy: -50, scale: 0.85 },
  'cam-side-3': { dx: 0, dy: 10, scale: 1.0 },
  'cam-side-4': { dx: -140, dy: -30, scale: 0.8 },
  'cam-side-5': { dx: 60, dy: 70, scale: 1.25 },
  'cam-side-6': { dx: -70, dy: -60, scale: 0.9 },
};

function makeAreaFrame(cameraId: SideCamId, payload: string, n: number): PixelFrame {
  const f: PixelFrame = {
    data: new Uint8Array(AREA_W * AREA_H * 4),
    widthPx: AREA_W,
    heightPx: AREA_H,
  };
  fillRect(f, 0, 0, AREA_W, AREA_H, KRAFT);
  const rng = lcg(cameraSeed(cameraId) + n * 7919);
  const { dx, dy, scale } = SIDE_LAYOUT[cameraId];
  const jx = Math.round((rng() - 0.5) * 8); // ±4 px jitter per capture
  const jy = Math.round((rng() - 0.5) * 6);
  const labelW = Math.round(470 * scale);
  const labelH = Math.round(150 * scale);
  const lx = Math.round(AREA_W / 2 - labelW / 2 + dx + jx);
  const ly = Math.round(AREA_H / 2 - labelH / 2 + dy + jy);
  const faint = cameraId === 'cam-side-6';
  const labelRgb: [number, number, number] = faint ? [196, 196, 196] : [246, 246, 246];
  fillRect(f, lx, ly, lx + labelW, ly + labelH, labelRgb);
  const barW = labelW - 40;
  const modules = code128Elements(payload).reduce((a, b) => a + b, 0);
  const mpx = Math.max(1, Math.floor(barW / modules));
  const barY = ly + Math.round(labelH / 2 - 30);
  drawCode128(f, payload, lx + 20, barY, mpx);
  // Faint cam: bars only 15 levels darker than the label (sub-threshold).
  if (faint) {
    for (let i = 0; i < f.data.length; i += 4) {
      if (f.data[i] === 0 && f.data[i + 1] === 0 && f.data[i + 2] === 0) {
        f.data[i] = 181;
        f.data[i + 1] = 181;
        f.data[i + 2] = 181;
      }
    }
  }
  // Glare cam: a bright uniform wash over the label (no bar structure).
  if (cameraId === 'cam-side-3') {
    fillRect(f, lx - 30, ly - 40, lx + labelW + 30, ly + labelH + 40, [250, 250, 250]);
  }
  return f;
}

function makeStrip(cameraId: 'ls-top' | 'ls-bottom', payload: string, n: number): PixelFrame {
  const f: PixelFrame = {
    data: new Uint8Array(HIW_STRIP.widthPx * HIW_STRIP.rows * 4),
    widthPx: HIW_STRIP.widthPx,
    heightPx: HIW_STRIP.rows,
  };
  const dim = cameraId === 'ls-bottom' ? 0.92 : 1.0;
  const kraft: [number, number, number] = [
    Math.round(KRAFT[0] * dim),
    Math.round(KRAFT[1] * dim),
    Math.round(KRAFT[2] * dim),
  ];
  fillRect(f, 0, 0, f.widthPx, f.heightPx, kraft);
  const rng = lcg(cameraSeed(cameraId) + n * 7919);
  const { x0, x1, y0, y1 } = HIW_STRIP.label;
  const jx = Math.round((rng() - 0.5) * 4);
  const labelRgb: [number, number, number] = [
    Math.round(246 * dim),
    Math.round(246 * dim),
    Math.round(246 * dim),
  ];
  fillRect(f, x0 + jx, y0, x1 + jx, y1, labelRgb);
  const modules = code128Elements(payload).reduce((a, b) => a + b, 0);
  const barW = x1 - x0 - 40;
  const mpx = Math.max(1, Math.floor(barW / modules));
  drawCode128(f, payload, x0 + 20 + jx, y0 + Math.round((y1 - y0) / 2 - 30), mpx);
  // Tape seams (visual, mirrored from the HIW strip).
  for (const sy of HIW_STRIP.tapeSeamY) {
    fillRect(f, 0, sy, f.widthPx, sy + 6, [110, 126, 143]);
  }
  return f;
}

/** The exact synthetic frame this camera emits as capture #n. */
export function makeSyntheticFrame(
  cameraId: LiveCameraId,
  payload: string,
  n: number,
): PixelFrame {
  if (cameraId === 'ls-top' || cameraId === 'ls-bottom') {
    return makeStrip(cameraId, payload, n);
  }
  return makeAreaFrame(cameraId, payload, n);
}

/**
 * Wrap a synthetic frame in a LiveCaptureInput for the client.
 * `image` bytes come from the (browser canvas) encoder; headless tests
 * inject a stub encoder and a fake service.
 */
export function syntheticCapture(
  cameraId: LiveCameraId,
  n: number,
  image: { data: Uint8Array; width: number; height: number; mime: 'image/png' | 'image/jpeg' },
  simTimeMs: number,
  parcelFrontZMm: number,
): LiveCaptureInput {
  return {
    captureId: `${cameraId}-live-${n}`,
    cameraId,
    sourceType: liveCameraKind(cameraId),
    simTimeMs: Math.round(simTimeMs),
    encoderSpanMm: [Math.round(parcelFrontZMm - 6), Math.round(parcelFrontZMm + 6)],
    image,
  };
}

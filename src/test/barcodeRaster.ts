/**
 * Shared headless Code 128 rasterizer for decoder tests (extracted from
 * pixelDecoder.test.ts for the t4-zxing suite): parses bwip-js' SVG output
 * into bar geometry and draws it into plain RGBA buffers. No DOM/WebGL.
 */

import * as bwip from 'bwip-js';
import type { PixelFrame } from '../pipeline/pixelDecoder';

export interface BarBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Parse bwip's code128 SVG into bar geometry (bars are vertical <path> lines). */
export function parseBarcodeSvg(
  text: string,
  scale: number,
): { bars: { x: number; w: number }[]; barTop: number; barBottom: number } {
  const svg = bwip.toSVG({ bcid: 'code128', text, includetext: false, padding: 10, scale });
  const bars: { x: number; w: number }[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const m of svg.matchAll(/<path stroke="[^"]*" stroke-width="(\d+)" d="([^"]*)"/g)) {
    const w = Number(m[1]);
    for (const lm of m[2].matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)) {
      const cx = Number(lm[1]);
      // bwip draws lines bottom-up (y1 > y2) — take min/max of the endpoints.
      const yLo = Math.min(Number(lm[2]), Number(lm[4]));
      const yHi = Math.max(Number(lm[2]), Number(lm[4]));
      bars.push({ x: cx - w / 2, w });
      minY = Math.min(minY, yLo);
      maxY = Math.max(maxY, yHi);
    }
  }
  return { bars, barTop: minY, barBottom: maxY };
}

/**
 * Draw a bwip code128 barcode into an existing white RGBA frame at offset
 * (ox, oy). Returns the bar band bbox in FRAME pixels (from the SVG
 * geometry).
 */
export function drawBarcode(
  frame: PixelFrame,
  text: string,
  scale: number,
  ox: number,
  oy: number,
): BarBBox {
  const { bars, barTop, barBottom } = parseBarcodeSvg(text, scale);
  const barW = bars.length > 1 ? Math.max(...bars.map((b) => b.x + b.w)) : 0;
  const bbox: BarBBox = { x: ox, y: oy + barTop, w: barW, h: barBottom - barTop };
  // Draw bars (nearest-neighbor, no blur — the clean case).
  for (const b of bars) {
    for (
      let y = Math.max(0, Math.floor(oy + barTop));
      y < Math.min(frame.heightPx, Math.ceil(oy + barBottom));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(ox + b.x));
        x < Math.min(frame.widthPx, Math.ceil(ox + b.x + b.w));
        x++
      ) {
        const i = (y * frame.widthPx + x) * 4;
        frame.data[i] = 0;
        frame.data[i + 1] = 0;
        frame.data[i + 2] = 0;
      }
    }
  }
  return bbox;
}

/** Render a bwip code128 barcode into a fresh plain RGBA frame (white background). */
export function renderBarcode(
  text: string,
  scale = 4,
  canvasW = 640,
  canvasH = 480,
): { frame: PixelFrame; bbox: BarBBox } {
  const frame: PixelFrame = {
    data: new Uint8Array(canvasW * canvasH * 4).fill(255),
    widthPx: canvasW,
    heightPx: canvasH,
  };
  const bbox = drawBarcode(frame, text, scale, 0, 0);
  return { frame, bbox };
}

/**
 * Unit quad for a horizontal bar band at [x, y, x+w, y+h]. By default
 * corners are clamped to the frame; pass clamp: false to keep quads that
 * stick out (partially clipped).
 */
export function quadFor(
  bbox: BarBBox,
  widthPx = 640,
  heightPx = 480,
  clamp = true,
): [number, number][] {
  const { x, y, w, h } = bbox;
  const cl = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const x0 = clamp ? cl(x - 2, widthPx) : x - 2;
  const x1 = clamp ? cl(x + w + 2, widthPx) : x + w + 2;
  const y0 = clamp ? cl(y - 2, heightPx) : y - 2;
  const y1 = clamp ? cl(y + h + 2, heightPx) : y + h + 2;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

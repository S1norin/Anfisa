/**
 * t17: pixel decoder unit tests (issue #17, PIPE-010).
 *
 * Headless: renders bwip-js code128 SVGs into RGBA buffers (the same
 * technique the scene label textures use) and decodes them through
 * `pixelDecodeFrame`. No DOM/WebGL required.
 *
 * These tests also pin the bwip-derived table (scripts/gen-code128-table.mjs
 * verified it; the tests re-verify the decode path end-to-end).
 */

import { describe, expect, it } from 'vitest';
import * as bwip from 'bwip-js';
import { pixelDecodeFrame, type PixelFrame, type PixelLabelCandidate } from './pixelDecoder';

/** Render a bwip code128 barcode into a plain RGBA frame (white background). */
function renderBarcode(text: string, scale = 4, canvasW = 640, canvasH = 480): {
  frame: PixelFrame;
  /** Bar band bbox in canvas pixels (from the SVG geometry). */
  bbox: { x: number; y: number; w: number; h: number };
} {
  const svg = bwip.toSVG({ bcid: 'code128', text, includetext: false, padding: 10, scale });
  // bwip SVG: viewBox in px at the given scale; bars are <path> vertical lines.
  const bars: { cx: number; x: number; w: number }[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const m of svg.matchAll(/<path stroke="[^"]*" stroke-width="(\d+)" d="([^"]*)"/g)) {
    const w = Number(m[1]);
    for (const lm of m[2].matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)) {
      const cx = Number(lm[1]);
      // bwip draws lines bottom-up (y1 > y2) — take min/max of the endpoints.
      const yLo = Math.min(Number(lm[2]), Number(lm[4]));
      const yHi = Math.max(Number(lm[2]), Number(lm[4]));
      bars.push({ cx, x: cx - w / 2, w });
      minY = Math.min(minY, yLo);
      maxY = Math.max(maxY, yHi);
    }
  }
  const barW = bars.length > 1 ? Math.max(...bars.map((b) => b.x + b.w)) : 0;
  const bbox = { x: 0, y: minY, w: barW, h: maxY - minY };

  const frame: PixelFrame = {
    data: new Uint8Array(canvasW * canvasH * 4).fill(255),
    widthPx: canvasW,
    heightPx: canvasH,
  };
  // Draw bars (nearest-neighbor, no blur — the clean case).
  for (const b of bars) {
    for (let y = Math.max(0, Math.floor(bbox.y)); y < Math.min(canvasH, Math.ceil(bbox.y + bbox.h)); y++) {
      for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(canvasW, Math.ceil(b.x + b.w)); x++) {
        const i = (y * canvasW + x) * 4;
        frame.data[i] = 0;
        frame.data[i + 1] = 0;
        frame.data[i + 2] = 0;
      }
    }
  }
  return { frame, bbox };
}

/** Unit quad for a horizontal bar band at [x, y, x+w, y+h]. */
function quadFor(
  bbox: { x: number; y: number; w: number; h: number },
  widthPx = 640,
  heightPx = 480,
): [number, number][] {
  const { x, y, w, h } = bbox;
  // Fit tightly around the bar band + a little quiet zone, clamped to the
  // frame (corners outside the frame would be rejected as OUT_OF_FRAME).
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const x0 = clamp(x - 2, widthPx);
  const x1 = clamp(x + w + 2, widthPx);
  const y0 = clamp(y - 2, heightPx);
  const y1 = clamp(y + h + 2, heightPx);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function decodeSingle(frame: PixelFrame, quad: [number, number][], id = 'L-0'): PixelFrame & {
  result: ReturnType<typeof pixelDecodeFrame>[number];
} {
  const cand: PixelLabelCandidate = { labelInstanceId: id, quadPx: quad };
  const [result] = pixelDecodeFrame(frame, [cand]);
  return { ...frame, result };
}

describe('code128Table (derived from bwip-js)', () => {
  it('has 107 distinct patterns summing to 11 modules (stop = 233111 + guard)', async () => {
    const { CODE128_PATTERNS, CODE128_STOP, CODE128_STOP_GUARD_MODULES } = await import('./code128Table');
    expect(CODE128_PATTERNS).toHaveLength(107);
    const keys = new Set(CODE128_PATTERNS.map((p) => p.join(',')));
    expect(keys.size).toBe(107);
    for (const p of CODE128_PATTERNS) {
      expect(p.reduce((a, b) => a + b, 0)).toBe(11);
    }
    expect([...CODE128_PATTERNS[CODE128_STOP]]).toEqual([2, 3, 3, 1, 1, 1]);
    expect(CODE128_STOP_GUARD_MODULES).toBe(2);
  });
});

describe('pixelDecodeFrame — clean renders (no blur/noise)', () => {
  it('decodes a B-mode mixed payload (KTY-1234)', () => {
    const { frame, bbox } = renderBarcode('KTY-1234');
    const { result } = decodeSingle(frame, quadFor(bbox));
    expect(result.processingMode).toBe('PIXEL_DECODER');
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe('KTY-1234');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('decodes a C-mode numeric payload (24 digits)', () => {
    const digits = '0123456789012345678901234567';
    const { frame, bbox } = renderBarcode(digits, 4, 800, 480);
    const { result } = decodeSingle(frame, quadFor(bbox, 800, 480));
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe(digits);
  });

  it('decodes a C->B latched payload (12345678ABCD)', () => {
    const text = '12345678ABCD';
    const { frame, bbox } = renderBarcode(text);
    const { result } = decodeSingle(frame, quadFor(bbox));
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe(text);
  });

  it('decodes a single-char payload (Z)', () => {
    const { frame, bbox } = renderBarcode('Z');
    const { result } = decodeSingle(frame, quadFor(bbox));
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe('Z');
  });

  it('reports contract fields for a decode', () => {
    const { frame, bbox } = renderBarcode('KTY-0001');
    const { result } = decodeSingle(frame, quadFor(bbox));
    expect(result).toMatchObject({
      labelInstanceId: 'L-0',
      decoded: true,
      processingMode: 'PIXEL_DECODER',
      reasons: [],
    });
    expect(result.scanLines).toBeGreaterThan(0);
    expect(result.scanLinesDecoded).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe('pixelDecodeFrame — robustness (deterministic)', () => {
  it('decodes with a blurred label (simulates scene minification)', () => {
    const { frame, bbox } = renderBarcode('KTY-2468');
    // Box blur radius 1 over the bar band.
    const { data, widthPx, heightPx } = frame;
    const src = new Uint8ClampedArray(data);
    for (let y = 0; y < heightPx; y++) {
      for (let x = 0; x < widthPx; x++) {
        const i = (y * widthPx + x) * 4;
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= widthPx || yy >= heightPx) continue;
            s += src[(yy * widthPx + xx) * 4];
            n++;
          }
        }
        const v = Math.round(s / n);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
    }
    const { result } = decodeSingle(frame, quadFor(bbox));
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe('KTY-2468');
  });

  it('decodes with deterministic salt noise at 6% amplitude', () => {
    const { frame, bbox } = renderBarcode('KTY-9999');
    let s = 1234567;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < frame.data.length; i += 4) {
      const n = Math.round((rand() - 0.5) * 30); // ±15
      frame.data[i] = Math.max(0, Math.min(255, frame.data[i] + n));
      frame.data[i + 1] = frame.data[i];
      frame.data[i + 2] = frame.data[i];
    }
    const { result } = decodeSingle(frame, quadFor(bbox));
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe('KTY-9999');
  });

  it('fails (no false positive) on a blank quad', () => {
    const frame: PixelFrame = {
      data: new Uint8Array(320 * 240 * 4).fill(255),
      widthPx: 320,
      heightPx: 240,
    };
    const quad: [number, number][] = [
      [40, 60],
      [200, 60],
      [200, 180],
      [40, 180],
    ];
    const { result } = decodeSingle(frame, quad);
    expect(result.decoded).toBe(false);
    expect(result.decodedPayload).toBeUndefined();
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('fails when the label is occluded in the middle', () => {
    const { frame, bbox } = renderBarcode('KTY-5566');
    // Paint a 60px white occluder across the middle of the bar band.
    const cx = Math.round(bbox.x + bbox.w / 2);
    for (let y = Math.floor(bbox.y); y < bbox.y + bbox.h; y++) {
      for (let x = cx - 30; x < cx + 30; x++) {
        const i = (y * frame.widthPx + x) * 4;
        frame.data[i] = 255;
        frame.data[i + 1] = 255;
        frame.data[i + 2] = 255;
      }
    }
    const { result } = decodeSingle(frame, quadFor(bbox));
    expect(result.decoded).toBe(false);
    expect(result.decodedPayload).toBeUndefined();
  });

  it('flags quads outside the frame', () => {
    const { frame } = renderBarcode('KTY-1234');
    const cand: PixelLabelCandidate = {
      labelInstanceId: 'L-out',
      quadPx: [
        [-50, -50],
        [450, -50],
        [450, 50],
        [-50, 50],
      ],
    };
    const [result] = pixelDecodeFrame(frame, [cand]);
    expect(result.decoded).toBe(false);
    expect(result.reasons).toContain('PIXEL:OUT_OF_FRAME');
    expect(result.labelInstanceId).toBe('L-out');
  });

  it('flags a degenerate (tiny) quad', () => {
    const { frame } = renderBarcode('KTY-1234');
    const cand: PixelLabelCandidate = {
      labelInstanceId: 'L-tiny',
      quadPx: [
        [100, 100],
        [104, 100],
        [104, 120],
        [100, 120],
      ],
    };
    const [result] = pixelDecodeFrame(frame, [cand]);
    expect(result.decoded).toBe(false);
    expect(result.reasons).toContain('PIXEL:DEGENERATE');
  });
});

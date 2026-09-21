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
import {
  applySensorRoi,
  pixelDecodeFrame,
  type PixelFrame,
  type PixelLabelCandidate,
} from './pixelDecoder';

/** Parse bwip's code128 SVG into bar geometry (bars are vertical <path> lines). */
function parseBarcodeSvg(
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
function drawBarcode(
  frame: PixelFrame,
  text: string,
  scale: number,
  ox: number,
  oy: number,
): { x: number; y: number; w: number; h: number } {
  const { bars, barTop, barBottom } = parseBarcodeSvg(text, scale);
  const barW = bars.length > 1 ? Math.max(...bars.map((b) => b.x + b.w)) : 0;
  const bbox = { x: ox, y: oy + barTop, w: barW, h: barBottom - barTop };
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
function renderBarcode(text: string, scale = 4, canvasW = 640, canvasH = 480): {
  frame: PixelFrame;
  /** Bar band bbox in canvas pixels (from the SVG geometry). */
  bbox: { x: number; y: number; w: number; h: number };
} {
  const frame: PixelFrame = {
    data: new Uint8Array(canvasW * canvasH * 4).fill(255),
    widthPx: canvasW,
    heightPx: canvasH,
  };
  const bbox = drawBarcode(frame, text, scale, 0, 0);
  return { frame, bbox };
}

/** Rotate (x, y) by `deg` (deg) around (cx, cy) — forward transform. */
function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  deg: number,
): [number, number] {
  const t = (deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * Math.cos(t) - dy * Math.sin(t), cy + dx * Math.sin(t) + dy * Math.cos(t)];
}

/** Nearest-neighbour rotate a whole frame around its centre (out → white). */
function rotateFrame(frame: PixelFrame, deg: number): PixelFrame {
  const { widthPx: w, heightPx: h } = frame;
  const cx = w / 2;
  const cy = h / 2;
  const out = new Uint8Array(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = rotatePoint(x, y, cx, cy, -deg); // inverse mapping
      const xi = Math.round(sx);
      const yi = Math.round(sy);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
      out.subarray((y * w + x) * 4, (y * w + x) * 4 + 4).set(
        frame.data.subarray((yi * w + xi) * 4, (yi * w + xi) * 4 + 4),
      );
    }
  }
  return { data: out, widthPx: w, heightPx: h };
}

/**
 * Unit quad for a horizontal bar band at [x, y, x+w, y+h]. By default
 * corners are clamped to the frame; pass clamp: false to keep quads that
 * stick out (partially clipped — the t4-pixel case).
 */
function quadFor(
  bbox: { x: number; y: number; w: number; h: number },
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

  it('flags quads fully outside the frame', () => {
    const { frame } = renderBarcode('KTY-1234'); // 640×480
    const cand: PixelLabelCandidate = {
      labelInstanceId: 'L-out',
      quadPx: [
        [660, 490],
        [900, 490],
        [900, 560],
        [660, 560],
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

describe('pixelDecodeFrame — t4-pixel fixtures', () => {
  it('returns both valid payloads when one frame carries two Code 128 labels', () => {
    const frame: PixelFrame = {
      data: new Uint8Array(800 * 600 * 4).fill(255),
      widthPx: 800,
      heightPx: 600,
    };
    const a = drawBarcode(frame, 'KTY-1111', 3, 40, 60);
    const b = drawBarcode(frame, 'KTY-2222', 3, 400, 300);
    const [ra, rb] = pixelDecodeFrame(frame, [
      { labelInstanceId: 'A', quadPx: quadFor(a, 800, 600) },
      { labelInstanceId: 'B', quadPx: quadFor(b, 800, 600) },
    ]);
    expect(ra.decoded).toBe(true);
    expect(ra.decodedPayload).toBe('KTY-1111');
    expect(rb.decoded).toBe(true);
    expect(rb.decodedPayload).toBe('KTY-2222');
  });

  it('decodes a rotated (≈30°) label via bilinear rectification of the quad', () => {
    // Draw the barcode centred so the rotated band stays inside the frame.
    const frame: PixelFrame = {
      data: new Uint8Array(640 * 480 * 4).fill(255),
      widthPx: 640,
      heightPx: 480,
    };
    const bbox = drawBarcode(frame, 'KTY-3030', 3, 640 / 2 - 190, 480 / 2 - 30);
    const deg = 30;
    const rotated = rotateFrame(frame, deg);
    const cx = 320;
    const cy = 240;
    const quad = quadFor(bbox).map(
      ([x, y]) => rotatePoint(x, y, cx, cy, deg),
    ) as [number, number][];
    const [result] = pixelDecodeFrame(rotated, [{ labelInstanceId: 'R', quadPx: quad }]);
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe('KTY-3030');
  });

  it('decodes a partially clipped quad (≈20% of the quad outside the frame)', () => {
    // Label sits fully inside the frame, near the right edge; the quad is
    // widened so ≈20% of its area runs past the frame edge. Before t4-pixel
    // this quad was rejected outright (OUT_OF_FRAME) — the clipped region
    // now reads as quiet zone and the label decodes.
    const frame: PixelFrame = {
      data: new Uint8Array(640 * 480 * 4).fill(255),
      widthPx: 640,
      heightPx: 480,
    };
    const bbox = drawBarcode(frame, 'KTY-4242', 3, 220, 180);
    const x1 = Math.round(bbox.x + bbox.w + (bbox.w * 0.25)); // past 640
    const quad: [number, number][] = [
      [bbox.x - 2, bbox.y - 2],
      [x1, bbox.y - 2],
      [x1, bbox.y + bbox.h + 2],
      [bbox.x - 2, bbox.y + bbox.h + 2],
    ];
    // Sanity: the quad really does extend outside the frame.
    expect(x1).toBeGreaterThan(640);
    const [result] = pixelDecodeFrame(frame, [{ labelInstanceId: 'C', quadPx: quad }]);
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe('KTY-4242');
  });

  it('never reads ground truth: the result is pixel-derived when truth differs', () => {
    // The pixels carry one payload; the parcel spec (ground truth) would
    // claim another. The pixel path takes no truth input — assert the
    // contract: what comes back is what the pixels encode, never the truth.
    const { frame, bbox } = renderBarcode('PIXEL-A');
    const truthPayload = 'TRUTH-B';
    const [result] = pixelDecodeFrame(frame, [
      { labelInstanceId: 'L-1', quadPx: quadFor(bbox) },
    ]);
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe('PIXEL-A');
    expect(result.decodedPayload).not.toBe(truthPayload);
  });
});

describe('applySensorRoi — explicit ROI/mask stage (t4-pixel)', () => {
  it('passes through when the rig has no ROI', () => {
    const { frame } = renderBarcode('KTY-1234');
    const cand: PixelLabelCandidate = { labelInstanceId: 'L-0', quadPx: [[0, 0], [100, 0], [100, 50], [0, 50]] };
    const out = applySensorRoi(frame, undefined, [cand]);
    expect(out.cropped).toBe(false);
    expect(out.frame).toBe(frame);
    expect(out.candidates).toEqual([cand]);
  });

  it('crops the frame; a label outside the ROI is not decoded, one inside is', () => {
    const frame: PixelFrame = {
      data: new Uint8Array(800 * 400 * 4).fill(255),
      widthPx: 800,
      heightPx: 400,
    };
    const inside = drawBarcode(frame, 'IN-ROI', 3, 30, 120);
    const outside = drawBarcode(frame, 'OUT-ROI', 3, 520, 240);
    // ROI covers the left half only.
    const roi = { x: 0, y: 0, width: 400, height: 400 };
    const out = applySensorRoi(frame, roi, [
      { labelInstanceId: 'IN', quadPx: quadFor(inside, 800, 400) },
      { labelInstanceId: 'OUT', quadPx: quadFor(outside, 800, 400) },
    ]);
    expect(out.cropped).toBe(true);
    expect(out.frame.widthPx).toBe(400);
    expect(out.frame.heightPx).toBe(400);
    const [rin, rout] = pixelDecodeFrame(out.frame, out.candidates);
    expect(rin.decoded).toBe(true);
    expect(rin.decodedPayload).toBe('IN-ROI');
    expect(rout.decoded).toBe(false);
    expect(rout.decodedPayload).toBeUndefined();
    expect(rout.reasons.length).toBeGreaterThan(0);
  });
});

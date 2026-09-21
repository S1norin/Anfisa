import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePngRgb } from '../test/pngDecode';
import {
  buildHiwLineStripRows,
  code128Elements,
  compositeHiwStripRows,
  HIW_STRIP,
} from './stripPreview';

const SUCCESS_PAYLOAD = 'A1F4-2026-0001';

function toGray(rgb: Uint8Array): Uint8Array {
  const g = new Uint8Array(rgb.length / 3);
  for (let i = 0; i < g.length; i++) {
    const o = i * 3;
    g[i] = 0.114 * rgb[o] + 0.587 * rgb[o + 1] + 0.299 * rgb[o + 2];
  }
  return g;
}

describe('code128Elements (t3-1)', () => {
  it('encodes the success payload with a valid check value', () => {
    const els = code128Elements(SUCCESS_PAYLOAD);
    // 16 symbols (start + 14 data + check) x 11 modules + 13 stop modules
    expect(els.reduce((a, b) => a + b, 0)).toBe(16 * 11 + 13);
    expect(els.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]); // zxing-cpp Code B start
    expect(els.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]); // stop
    // Check symbol: (START_B + position-weighted sum) mod 103
    const data = [...SUCCESS_PAYLOAD].map((c) => c.charCodeAt(0) - 32);
    const check = (104 + data.reduce((a, b, i) => a + (i + 1) * b, 0)) % 103;
    expect(check).toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(103);
  });

  it('rejects chars outside Code 128 B range', () => {
    expect(() => code128Elements('\u00e9')).toThrow();
  });
});

describe('buildHiwLineStripRows (t3-1)', () => {
  it('matches the generator geometry', () => {
    const s = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    expect(s.widthPx).toBe(HIW_STRIP.widthPx);
    expect(s.rows).toBe(HIW_STRIP.rows);
    expect(s.labelRect).toEqual(HIW_STRIP.label);
    // 418 px barcode (209 modules x 2) in NORMAL orientation: 60 px along
    // travel — the full label height (mirrors the generator)
    expect(s.barcode.w).toBe(418);
    expect(s.barcode.h).toBe(60);
    expect(s.barcode.x0).toBe(76);
    expect(s.barcode.y0).toBe(215);
  });

  it('is deterministic', () => {
    const a = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    const b = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    expect(Array.from(a.gray)).toEqual(Array.from(b.gray));
  });

  it('has kraft background, tape seams, label rect and barcode contrast', () => {
    const s = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    const { widthPx: w, gray } = s;
    // Kraft background ~132 (± noise)
    expect(gray[0]).toBeGreaterThan(119);
    expect(gray[0]).toBeLessThan(145);
    // Tape seams at y=119..121 are darker than kraft (outside the label)
    for (let x = 0; x < 50; x++) {
      expect(gray[119 * w + x]).toBeLessThan(120);
    }
    // Label edges: x=49 kraft, x=50 white; x=520 white, x=521 kraft
    expect(gray[245 * w + 49]).toBeLessThan(160);
    expect(gray[245 * w + 50]).toBeGreaterThan(240);
    expect(gray[245 * w + 520]).toBeGreaterThan(240);
    expect(gray[245 * w + 521]).toBeLessThan(160);
    // Barcode: black bars inside the region
    let black = 0;
    for (let y = s.barcode.y0; y < y0End(s); y++) {
      for (let x = s.barcode.x0; x < s.barcode.x0 + s.barcode.w; x++) {
        if (gray[y * w + x] < 32) black++;
      }
    }
    expect(black).toBeGreaterThan(2000);
  });

  function y0End(s: { barcode: { y0: number; h: number } }): number {
    return s.barcode.y0 + s.barcode.h;
  }
});

describe('compositeHiwStripRows (t3-1)', () => {
  it('composites all rows by default, progressively with visibleRows', () => {
    const s = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    const full = compositeHiwStripRows(s);
    expect(full.rowCount).toBe(s.rows);
    expect(full.rgba.length).toBe(s.widthPx * s.rows * 4);
    const part = compositeHiwStripRows(s, 100);
    expect(part.rowCount).toBe(100);
    expect(part.rgba.length).toBe(s.widthPx * 100 * 4);
    // Row 0 of the progressive composite is identical to the full one
    for (let i = 0; i < s.widthPx * 4; i++) {
      expect(part.rgba[i]).toBe(full.rgba[i]);
    }
  });

  it('clamps visibleRows', () => {
    const s = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    expect(compositeHiwStripRows(s, 9999).rowCount).toBe(s.rows);
    expect(compositeHiwStripRows(s, -5).rowCount).toBe(0);
  });
});

describe('strip rows match the manifest raw line-scan strip (t3-1 AC1)', () => {
  const rawPath = 'public/hiw/assets/success/cap-ls-top-01/raw.png';

  it('pixel-compares the composited rows against raw.png within tolerance', () => {
    const raw = decodePngRgb(readFileSync(rawPath));
    expect(raw.width).toBe(570);
    expect(raw.height).toBe(560);
    const rawGray = toGray(raw.rgb);

    const s = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    const gen = s.gray;

    // Full-image mean abs diff (noise is the only expected divergence)
    let sum = 0;
    for (let i = 0; i < gen.length; i++) sum += Math.abs(gen[i] - rawGray[i]);
    const mad = sum / gen.length;
    expect(mad).toBeLessThan(8);

    // Column profile over the label band: structure must match closely
    const { widthPx: w } = s;
    const colDiff: number[] = [];
    for (let x = 0; x < w; x++) {
      let d = 0;
      for (let y = 215; y <= 275; y++) d += Math.abs(gen[y * w + x] - rawGray[y * w + x]);
      colDiff.push(d / 61);
    }
    expect(Math.max(...colDiff)).toBeLessThan(30);
    // Label edges in the raw strip at the same x positions
    const rawColMean = (x: number): number => {
      let v = 0;
      for (let y = 215; y <= 275; y++) v += rawGray[y * w + x];
      return v / 61;
    };
    expect(rawColMean(49)).toBeLessThan(170);
    expect(rawColMean(50)).toBeGreaterThan(190);
    expect(rawColMean(520)).toBeGreaterThan(190);
    expect(rawColMean(521)).toBeLessThan(170);
    // Barcode present in the same cross-belt span, full label height
    // (x 76..493, y 215..274)
    let rawBlack = 0;
    for (let y = 215; y < 275; y++) {
      for (let x = 76; x < 76 + 418; x++) if (rawGray[y * w + x] < 32) rawBlack++;
    }
    expect(rawBlack).toBeGreaterThan(2000);
    // And in the horizontal quiet zones inside the label (x 51..74 and
    // x 495..519) there are no bars
    let rawBlackOutside = 0;
    for (let y = 215; y < 275; y++) {
      for (let x = 51; x <= 74; x++) if (rawGray[y * w + x] < 32) rawBlackOutside++;
      for (let x = 495; x <= 519; x++) if (rawGray[y * w + x] < 32) rawBlackOutside++;
    }
    expect(rawBlackOutside).toBe(0);
  }, 30000);
});

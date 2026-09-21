import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
  buildHiwLineStripRows,
  code128Elements,
  compositeHiwStripRows,
  HIW_STRIP,
} from './stripPreview';

const SUCCESS_PAYLOAD = 'A1F4-2026-0001';

/**
 * Minimal 8-bit non-interlaced RGB PNG decoder (test-only).
 * Supports the five row filters; sufficient for cv2.imwrite output.
 */
function decodePngRgb(buf: Uint8Array): {
  width: number;
  height: number;
  rgb: Uint8Array;
} {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) throw new Error('not a png');
  }
  const u32 = (b: Uint8Array, o: number): number =>
    (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  const tag = (b: Uint8Array, s: string): boolean =>
    [...s].every((ch, i) => b[i] === ch.charCodeAt(0));
  let off = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (off < buf.length) {
    const len = u32(buf, off);
    const typeTag = buf.subarray(off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (tag(typeTag, 'IHDR')) {
      width = u32(data, 0);
      height = u32(data, 4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
        throw new Error('unsupported png (need 8-bit RGB, no interlace)');
      }
    } else if (tag(typeTag, 'IDAT')) {
      idat.push(new Uint8Array(data));
    }
    off += 12 + len;
  }
  const totalLen = idat.reduce((a, b) => a + b.length, 0);
  const flat = new Uint8Array(totalLen);
  {
    let p = 0;
    for (const chunk of idat) {
      flat.set(chunk, p);
      p += chunk.length;
    }
  }
  const raw = inflateSync(flat);
  const stride = width * 3;
  const rgb = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(
      y * (stride + 1) + 1,
      (y + 1) * (stride + 1),
    );
    const prev =
      y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      // Sub/Average/Paeth reference DECODED neighbours, not raw bytes.
      const a = x >= 3 ? rgb[y * stride + x - 3] : 0;
      const b = prev[x];
      const c = x >= 3 ? prev[x - 3] : 0;
      let v = row[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          v = (v + a) & 255;
          break;
        case 2:
          v = (v + b) & 255;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 255;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 255;
          break;
        }
        default:
          throw new Error(`bad filter ${filter}`);
      }
      rgb[y * stride + x] = v;
    }
  }
  return { width, height, rgb };
}

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
    expect(els.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]); // start B
    expect(els.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]); // stop
    // Check symbol: (START_B + sum(data)) mod 103
    const data = [...SUCCESS_PAYLOAD].map((c) => c.charCodeAt(0) - 32);
    const check = (104 + data.reduce((a, b) => a + b, 0)) % 103;
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
    // 418 px barcode (209 modules x 2) rotated: 50 px cross-belt, centered
    // (extends 9 px past the label top, exactly like the generator)
    expect(s.barcode.w).toBe(50);
    expect(s.barcode.h).toBe(418);
    expect(s.barcode.x0).toBe(260);
    expect(s.barcode.y0).toBe(61);
  });

  it('is deterministic', () => {
    const a = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    const b = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    expect(Array.from(a.gray)).toEqual(Array.from(b.gray));
  });

  it('has kraft background, tape seams, label rect and barcode contrast', () => {
    const s = buildHiwLineStripRows(SUCCESS_PAYLOAD);
    const { widthPx: w, gray } = s;
    // Kraft background ~143 (± noise)
    expect(gray[0]).toBeGreaterThan(130);
    expect(gray[0]).toBeLessThan(156);
    // Tape seams at y=119..121 are darker than kraft (outside the label)
    for (let x = 0; x < 85; x++) {
      expect(gray[119 * w + x]).toBeLessThan(120);
    }
    // Label edges: x=84 kraft, x=85 white; x=485 white, x=486 kraft
    expect(gray[200 * w + 84]).toBeLessThan(160);
    expect(gray[200 * w + 85]).toBeGreaterThan(240);
    expect(gray[200 * w + 485]).toBeGreaterThan(240);
    expect(gray[200 * w + 486]).toBeLessThan(160);
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
      for (let y = 70; y <= 470; y++) d += Math.abs(gen[y * w + x] - rawGray[y * w + x]);
      colDiff.push(d / 401);
    }
    expect(Math.max(...colDiff)).toBeLessThan(30);
    // Label edges in the raw strip at the same x positions
    const rawColMean = (x: number): number => {
      let v = 0;
      for (let y = 70; y <= 470; y++) v += rawGray[y * w + x];
      return v / 401;
    };
    expect(rawColMean(84)).toBeLessThan(170);
    expect(rawColMean(85)).toBeGreaterThan(190);
    expect(rawColMean(485)).toBeGreaterThan(190);
    expect(rawColMean(486)).toBeLessThan(170);
    // Barcode present in the same cross-belt span (x 260..309 has bars)
    let rawBlack = 0;
    for (let y = 61; y < 61 + 418; y++) {
      for (let x = 260; x < 310; x++) if (rawGray[y * w + x] < 32) rawBlack++;
    }
    expect(rawBlack).toBeGreaterThan(2000);
    // And outside it (x 100..200, label but no bars) there are no black bars
    let rawBlackOutside = 0;
    for (let y = 70; y <= 470; y++) {
      for (let x = 100; x < 200; x++) if (rawGray[y * w + x] < 32) rawBlackOutside++;
    }
    expect(rawBlackOutside).toBe(0);
  }, 30000);
});

/**
 * Test-only minimal PNG decoder (shared).
 *
 * Supports 8-bit non-interlaced RGB PNGs with the five row filters —
 * sufficient for cv2.imwrite output (the HIW asset generator).
 * `toPixelFrame` adapts the RGB output to a pipeline `PixelFrame` (RGBA).
 */

import { inflateSync } from 'node:zlib';
import type { PixelFrame } from '../pipeline/pixelDecoder';

export function decodePngRgb(buf: Uint8Array): {
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

/** RGB (packed, 3 channels) → pipeline PixelFrame (RGBA, 4 channels). */
export function rgbToPixelFrame(
  rgb: Uint8Array,
  width: number,
  height: number,
): PixelFrame {
  const data = new Uint8Array(width * height * 4);
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const s = p * 3;
    const d = p * 4;
    data[d] = rgb[s];
    data[d + 1] = rgb[s + 1];
    data[d + 2] = rgb[s + 2];
    data[d + 3] = 255;
  }
  return { data, widthPx: width, heightPx: height };
}

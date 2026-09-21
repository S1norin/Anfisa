/**
 * t4-zxing: ZXing C++ (wasm) engine tests.
 *
 * Deterministic + offline: the wasm binary is instantiated from
 * node_modules (see zxingDecoder.loadZxing test branch), so the suite needs
 * no network. Fixtures are the shared bwip-SVG rasterizer (src/test/
 * barcodeRaster.ts) — the same technique the scene label textures use.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as zxing from 'zxing-wasm/reader';
import type { PixelFrame, PixelLabelCandidate } from './pixelDecoder';
import { setZxingWasmBootstrap, zxingDecodeFrame } from './zxingDecoder';
import { drawBarcode, quadFor, renderBarcode } from '../test/barcodeRaster';

/**
 * Deterministic offline wasm: instantiate the reader binary straight from
 * node_modules (no server, no network, no CDN).
 */
beforeAll(() => {
  const buf = readFileSync(
    join(process.cwd(), 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'),
  );
  setZxingWasmBootstrap(() => {
    zxing.prepareZXingModule({
      overrides: {
        wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      },
    });
  });
});

describe('zxingDecodeFrame (t4-zxing)', () => {
  it('decodes a single bwip Code 128 render', async () => {
    const { frame, bbox } = renderBarcode('HELLO-123', 4, 640, 480);
    const cand: PixelLabelCandidate = {
      labelInstanceId: 'L-0',
      quadPx: quadFor(bbox, 640, 480),
    };
    const [result] = await zxingDecodeFrame(frame, [cand]);
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe('HELLO-123');
    expect(result.processingMode).toBe('PIXEL_DECODER');
    expect(result.confidence).toBe(1);
    expect(result.reasons).toEqual([]);
    expect(result.scanLines).toBeGreaterThan(0);
  });

  it('decodes multiple symbols in one frame and matches them to the right quads', async () => {
    // Two barcodes side by side in a single frame (the multi-symbol criterion).
    const frame: PixelFrame = {
      data: new Uint8Array(1600 * 600 * 4).fill(255),
      widthPx: 1600,
      heightPx: 600,
    };
    const bb1 = drawBarcode(frame, 'AAA-111', 5, 40, 100);
    const bb2 = drawBarcode(frame, 'BBB-222', 5, 800, 100);
    const cands: PixelLabelCandidate[] = [
      { labelInstanceId: 'L-1', quadPx: quadFor(bb1, 1600, 600) },
      { labelInstanceId: 'L-2', quadPx: quadFor(bb2, 1600, 600) },
    ];
    const results = await zxingDecodeFrame(frame, cands);
    expect(results[0].decoded).toBe(true);
    expect(results[0].decodedPayload).toBe('AAA-111');
    expect(results[1].decoded).toBe(true);
    expect(results[1].decodedPayload).toBe('BBB-222');
  });

  it('is deterministic: the same frame decodes identically twice', async () => {
    const { frame, bbox } = renderBarcode('DET-42', 4, 640, 480);
    const cand: PixelLabelCandidate = {
      labelInstanceId: 'L-0',
      quadPx: quadFor(bbox, 640, 480),
    };
    const a = await zxingDecodeFrame(frame, [cand]);
    const b = await zxingDecodeFrame(frame, [cand]);
    expect(a).toEqual(b);
  });

  it('reports ZXING:NO_SYMBOL for a candidate quad with no barcode', async () => {
    const { frame } = renderBarcode('SOME-CODE', 4, 640, 480);
    // White region bottom-right: no symbol there.
    const cand: PixelLabelCandidate = {
      labelInstanceId: 'L-empty',
      quadPx: [
        [480, 360],
        [620, 360],
        [620, 460],
        [480, 460],
      ],
    };
    const [result] = await zxingDecodeFrame(frame, [cand]);
    expect(result.decoded).toBe(false);
    expect(result.decodedPayload).toBeUndefined();
    expect(result.confidence).toBe(0);
    expect(result.reasons).toContain('ZXING:NO_SYMBOL');
    expect(result.processingMode).toBe('PIXEL_DECODER');
  });
});

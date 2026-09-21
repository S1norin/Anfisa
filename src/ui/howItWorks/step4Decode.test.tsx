/**
 * Step 4: line-scan decode (t3-4).
 *
 *  - AC1: the browser ZXing decode of the manifest rectified crop equals
 *    the manifest value (runs the real wasm engine on the real asset);
 *  - sample lines with dark/light run widths across the crop;
 *  - the 3D view highlights the reader that found the candidate
 *    (scene-state test);
 *  - no-read: explicit reasons, no fabricated value (DOM test).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import * as zxing from 'zxing-wasm/reader';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { decodePngRgb, rgbToPixelFrame } from '../../test/pngDecode';
import { setZxingWasmBootstrap, zxingDecodeFrame } from '../../pipeline/zxingDecoder';
import { buildSuccessManifest } from './fixtures';
import { computeSampleRuns } from './decodeRuns';
import {
  Step4Decode,
  decodeHighlightAt,
  readerFace,
} from './step4Decode';
import type { DecodeOutcome } from './cropDecode';
import { sceneHighlightAt } from './step1Entry';

const manifest = buildSuccessManifest();
const capture = manifest.captures.find((c) => c.kind === 'LINE_SCAN')!;
const SUCCESS_PAYLOAD = 'A1F4-2026-0001';

/** Deterministic offline wasm (same technique as zxingDecoder.test.ts). */
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

describe('AC1: browser ZXing decode of the manifest rectified crop', () => {
  it('decodes the real success crop to the manifest value', async () => {
    const png = readFileSync(
      join(process.cwd(), 'public', capture.decodeCropPath!),
    );
    const { width, height, rgb } = decodePngRgb(new Uint8Array(png));
    const frame = rgbToPixelFrame(rgb, width, height);
    expect(frame.widthPx).toBe(width);
    expect(frame.heightPx).toBe(height);
    const m = 4;
    const cand = {
      labelInstanceId: capture.candidate!.labelInstanceId,
      quadPx: [
        [m, m],
        [width - m, m],
        [width - m, height - m],
        [m, height - m],
      ] as [number, number][],
    };
    const [result] = await zxingDecodeFrame(frame, [cand]);
    expect(result.decoded).toBe(true);
    expect(result.decodedPayload).toBe(SUCCESS_PAYLOAD);
    expect(result.decodedPayload).toBe(capture.expectedDecode?.payload);
    expect(result.processingMode).toBe('PIXEL_DECODER');
  });
});

describe('computeSampleRuns (dark/light run widths)', () => {
  it('samples the real crop: alternating runs covering the full width', () => {
    const png = readFileSync(join(process.cwd(), 'public', capture.decodeCropPath!));
    const { width, height, rgb } = decodePngRgb(new Uint8Array(png));
    const frame = rgbToPixelFrame(rgb, width, height);
    const lines = computeSampleRuns(frame, 6);
    expect(lines).toHaveLength(6);
    // Evenly spaced, inset from the edges.
    expect(lines[0].y).toBeGreaterThan(0);
    expect(lines[5].y).toBeLessThan(height - 1);
    for (const line of lines) {
      expect(line.runs.length).toBeGreaterThanOrEqual(2);
      // Alternates dark/light.
      for (let i = 1; i < line.runs.length; i++) {
        expect(line.runs[i].dark).not.toBe(line.runs[i - 1].dark);
      }
      // Runs tile the full row width.
      const total = line.runs.reduce((a, r) => a + r.widthPx, 0);
      expect(total).toBe(width);
      // A Code 128 symbol has dark bars on every sample line.
      expect(line.runs.some((r) => r.dark)).toBe(true);
    }
  });
});

describe('decodeHighlightAt (scene state: the reader that found it)', () => {
  it('active only during step 4, with the top reader', () => {
    // Step 4 = [22500, 30000].
    const hl = decodeHighlightAt(manifest, 26250);
    expect(hl?.capture.captureId).toBe('cap-ls-top-01');
    expect(hl?.reader).toBe('top');
    expect(decodeHighlightAt(manifest, 18750)).toBeNull(); // step 3
    expect(decodeHighlightAt(manifest, 37500)).toBeNull(); // step 5
  });

  it('sceneHighlightAt reports line-scan-decode during step 4', () => {
    expect(sceneHighlightAt(manifest, 26250)).toBe('line-scan-decode');
    expect(sceneHighlightAt(manifest, 13750)).toBe('line-scan');
  });

  it('readerFace maps sensor ids', () => {
    expect(readerFace('ls-top')).toBe('top');
    expect(readerFace('ls-bottom')).toBe('bottom');
    expect(readerFace('cam-side-1')).toBe('side');
  });
});

describe('Step4Decode (DOM: sample lines before the value)', () => {
  const successOutcome: DecodeOutcome = {
    decoded: true,
    payload: SUCCESS_PAYLOAD,
    reasons: [],
    sampleLines: [
      { y: 60, runs: [{ dark: false, widthPx: 40 }, { dark: true, widthPx: 12 }] },
      { y: 120, runs: [{ dark: false, widthPx: 40 }, { dark: true, widthPx: 12 }] },
    ],
    widthPx: 700,
    heightPx: 730,
  };
  const stub = vi.fn(async () => successOutcome);

  it('shows reader, crop, sample lines + runs, then the pixel-decoded value', async () => {
    render(<Step4Decode manifest={manifest} timeMs={26250} decode={stub} />);
    expect(screen.getByTestId('step4-reader')).toHaveAttribute(
      'data-reader',
      'top',
    );
    expect(screen.getByTestId('step4-crop')).toBeTruthy();
    // Sample lines across the rectified barcode…
    const sampleLines = await screen.findAllByTestId('step4-sample-line');
    expect(sampleLines).toHaveLength(2);
    // …with dark/light run widths read out…
    const runs = screen.getByTestId('step4-runs');
    const segs = runs.querySelectorAll('[data-testid=step4-run-seg]');
    expect(segs).toHaveLength(2);
    expect(runs.textContent).toContain('1 bars / 1 spaces');
    // …and the value appears after the runs (DOM order).
    const value = await screen.findByTestId('step4-value');
    expect(value).toHaveTextContent(SUCCESS_PAYLOAD);
    expect(runs.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stub).toHaveBeenCalledOnce();
  });

  it('no read: explicit reasons, no fabricated value', async () => {
    const noRead: DecodeOutcome = {
      decoded: false,
      reasons: ['QUALITY:GLARE', 'ZXING:NO_SYMBOL'],
      sampleLines: successOutcome.sampleLines,
      widthPx: 700,
      heightPx: 730,
    };
    render(
      <Step4Decode
        manifest={manifest}
        timeMs={26250}
        decode={async () => noRead}
      />,
    );
    const noReadBox = await screen.findByTestId('step4-no-read');
    expect(noReadBox.textContent).toContain('no read');
    expect(screen.getAllByTestId('step4-reason')).toHaveLength(2);
    expect(screen.queryByTestId('step4-value')).toBeNull();
    // Sample lines are still shown (the decode was attempted).
    expect((await screen.findAllByTestId('step4-sample-line')).length).toBe(2);
  });

  it('non line-scan step: explicit empty state', () => {
    render(<Step4Decode manifest={manifest} timeMs={37500} decode={stub} />);
    expect(screen.getByTestId('step4-decode')).toHaveTextContent(
      'No line-scan capture',
    );
  });
});

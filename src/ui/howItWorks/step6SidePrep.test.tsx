/**
 * Step 6: side-image preparation (t5-1) tests.
 *
 *  - scene state: the selected camera's capture is prepared during step 6;
 *    the parcel pose is FROZEN at the capture encoder position for the
 *    whole step; sceneHighlightAt reports 'side-prep-frozen'.
 *  - AC3: the browser ZXing decode of the manifest perspective-corrected
 *    crops equals the manifest payload (real wasm engine, real assets);
 *    the glare crop decodes to an explicit failure, never a value.
 *  - DOM: the 2D stage chain from the manifest with operation labels;
 *    glare/low-contrast annotations when the manifest flags them;
 *    out-of-view cameras say "no label in frame" (no fabricated decode).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import * as zxing from 'zxing-wasm/reader';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parcelFrontZAt } from './layout';
import { decodePngRgb, rgbToPixelFrame } from '../../test/pngDecode';
import { setZxingWasmBootstrap, zxingDecodeFrame } from '../../pipeline/zxingDecoder';
import { buildNoReadManifest, buildSuccessManifest } from './fixtures';
import { sceneHighlightAt } from './step1Entry';
import type { DecodeOutcome } from './cropDecode';
import {
  Step6SidePrep,
  frozenFrontZAt,
  qualityFlags,
  sidePrepCaptureAt,
} from './step6SidePrep';

const manifest = buildSuccessManifest();
const noRead = buildNoReadManifest();
const SUCCESS_SIDE_PAYLOAD = 'B7K9-2026-0042';

/** Step 6 spans [37500, 45000) ms of the 60 s story. */
const T_STEP6 = 41_250;

describe('sidePrepCaptureAt (scene state: selected camera prepared)', () => {
  it('returns the selected camera area capture during step 6', () => {
    const cap = sidePrepCaptureAt(manifest, T_STEP6, 'cam-side-2')!;
    expect(cap.captureId).toBe('cap-cam-2-01');
    expect(cap.kind).toBe('AREA_CAMERA');
    expect(cap.sensorId).toBe('cam-side-2');
  });

  it('works for the no-read fixture too', () => {
    const cap = sidePrepCaptureAt(noRead, T_STEP6, 'cam-side-1')!;
    expect(cap.captureId).toBe('cap-cam-1-01');
  });

  it('is null outside step 6', () => {
    expect(sidePrepCaptureAt(manifest, 33_750, 'cam-side-1')).toBeNull(); // step 5
    expect(sidePrepCaptureAt(manifest, 45_000, 'cam-side-1')).toBeNull(); // step 7
  });
});

describe('frozenFrontZAt (pose frozen at the capture position)', () => {
  it('pins the parcel at the capture encoder position for the whole step', () => {
    const a = frozenFrontZAt(manifest, 37_501, 'cam-side-1');
    const b = frozenFrontZAt(manifest, 44_999, 'cam-side-1');
    expect(a).toBe(780);
    expect(a).toBe(b); // frozen — constant across the step
    // …and differs from the moving story pose, proving the freeze.
    expect(a).not.toBe(parcelFrontZAt(manifest.keyframes, 44_999));
  });

  it('follows the selected camera (each camera captured at its own position)', () => {
    expect(frozenFrontZAt(manifest, T_STEP6, 'cam-side-2')).toBe(785);
    expect(frozenFrontZAt(manifest, T_STEP6, 'cam-side-6')).toBe(805);
  });

  it('is null outside step 6', () => {
    expect(frozenFrontZAt(manifest, 33_750, 'cam-side-1')).toBeNull();
    expect(frozenFrontZAt(manifest, 45_000, 'cam-side-1')).toBeNull();
  });
});

describe('sceneHighlightAt (frozen highlight during step 6)', () => {
  it('reports side-prep-frozen only during step 6', () => {
    expect(sceneHighlightAt(manifest, T_STEP6)).toBe('side-prep-frozen');
    expect(sceneHighlightAt(manifest, 33_750)).toBe('side-cameras'); // step 5
    expect(sceneHighlightAt(manifest, 45_000)).not.toBe('side-prep-frozen');
  });
});

describe('AC3: pixel decode of the perspective-corrected crops', () => {
  /** Deterministic offline wasm (same technique as step 4 tests). */
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

  async function decodeCrop(
    fixture: 'success' | 'no-read',
    captureId: string,
  ): Promise<{ decoded: boolean; payload?: string; reasons: string[] }> {
    const png = readFileSync(join(process.cwd(), 'public', 'hiw', 'assets', fixture, captureId, 'decode-crop.png'));
    const { width, height, rgb } = decodePngRgb(new Uint8Array(png));
    const frame = rgbToPixelFrame(rgb, width, height);
    const m = 4;
    const cand = {
      labelInstanceId: 'L-side',
      quadPx: [
        [m, m],
        [width - m, m],
        [width - m, height - m],
        [m, height - m],
      ] as [number, number][],
    };
    const [result] = await zxingDecodeFrame(frame, [cand]);
    return {
      decoded: result.decoded,
      payload: result.decodedPayload,
      reasons: result.reasons,
    };
  }

  it('success: cam 1 and cam 2 perspective-corrected crops decode to the manifest payload', async () => {
    for (const cap of ['cap-cam-1-01', 'cap-cam-2-01']) {
      const r = await decodeCrop('success', cap);
      expect(r.decoded, cap).toBe(true);
      expect(r.payload).toBe(SUCCESS_SIDE_PAYLOAD);
    }
  });

  it('no-read: the glare crop fails with an explicit reason (never a value)', async () => {
    const r = await decodeCrop('no-read', 'cap-cam-1-01');
    expect(r.decoded).toBe(false);
    expect(r.payload).toBeUndefined();
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe('qualityFlags (manifest metadata annotations)', () => {
  it('reports the glare flag on the no-read cam 1 frame', () => {
    const cap = noRead.captures.find((c) => c.captureId === 'cap-cam-1-01')!;
    expect(qualityFlags(cap)).toEqual(['QUALITY:GLARE']);
  });

  it('reports low contrast on the no-read cam 2 frame', () => {
    const cap = noRead.captures.find((c) => c.captureId === 'cap-cam-2-01')!;
    expect(qualityFlags(cap)).toEqual(['QUALITY:LOW_CONTRAST']);
  });

  it('clean frames carry no flags', () => {
    const cap = manifest.captures.find((c) => c.captureId === 'cap-cam-1-01')!;
    expect(qualityFlags(cap)).toEqual([]);
  });
});

describe('Step6SidePrep (DOM: stage chain, flags, pixel-decoded value)', () => {
  const successOutcome: DecodeOutcome = {
    decoded: true,
    payload: SUCCESS_SIDE_PAYLOAD,
    reasons: [],
    sampleLines: [],
    widthPx: 145,
    heightPx: 89,
  };

  it('renders the six manifest stages with operation labels + the frozen pose note', async () => {
    const { unmount } = render(
      <Step6SidePrep
        manifest={manifest}
        timeMs={T_STEP6}
        selectedId="cam-side-1"
        decode={vi.fn(async () => successOutcome)}
      />,
    );
    const root = screen.getByTestId('step6-prep');
    expect(root).toHaveAttribute('data-capture-id', 'cap-cam-1-01');
    expect(root).toHaveAttribute('data-sensor', 'cam-side-1');
    expect(screen.getByTestId('step6-frozen').textContent).toContain('780 mm');
    // The full 2D stage chain from the manifest, each tile with the
    // capture id.
    for (const stage of [
      'raw',
      'maskedCrop',
      'grayscaleContrast',
      'edgeMap',
      'candidateOverlay',
      'rectifiedCrop',
    ]) {
      const tile = screen.getByTestId(`stage-tile-${stage}`);
      expect(tile).toHaveAttribute('data-capture-id', 'cap-cam-1-01');
      const img = screen.getByTestId(`stage-img-${stage}`) as HTMLImageElement;
      expect(img.src).toContain(`/cap-cam-1-01/${stage}.png`);
    }
    // Clean frame: no quality flags.
    expect(screen.queryByTestId('step6-quality-flags')).toBeNull();
    // Perspective-corrected crop + the pixel-decoded value.
    const cropImg = screen.getByTestId('step6-crop-img') as HTMLImageElement;
    expect(cropImg.src).toContain('cap-cam-1-01/decode-crop.png');
    const value = await screen.findByTestId('step6-value');
    expect(value).toHaveTextContent(SUCCESS_SIDE_PAYLOAD);
    unmount();
  });

  it('annotates glare when the manifest flags it, with the no-read reasons and no value', async () => {
    const noReadOutcome: DecodeOutcome = {
      decoded: false,
      reasons: ['QUALITY:GLARE', 'ZXING:NO_SYMBOL'],
      sampleLines: [],
      widthPx: 145,
      heightPx: 89,
    };
    const { unmount } = render(
      <Step6SidePrep
        manifest={noRead}
        timeMs={T_STEP6}
        selectedId="cam-side-1"
        decode={vi.fn(async () => noReadOutcome)}
      />,
    );
    const flags = screen.getAllByTestId('step6-flag');
    expect(flags.map((f) => f.textContent)).toContain('QUALITY:GLARE');
    const noReadBox = await screen.findByTestId('step6-no-read');
    expect(noReadBox.textContent).toContain('no read');
    expect(screen.getAllByTestId('step6-reason').length).toBe(2);
    expect(screen.queryByTestId('step6-value')).toBeNull();
    unmount();
  });

  it('labels the geometry candidate as illustrative (no-read cam 2)', async () => {
    const noReadOutcome: DecodeOutcome = {
      decoded: false,
      reasons: ['QUALITY:LOW_CONTRAST'],
      sampleLines: [],
      widthPx: 87,
      heightPx: 93,
    };
    const { unmount } = render(
      <Step6SidePrep
        manifest={noRead}
        timeMs={T_STEP6}
        selectedId="cam-side-2"
        decode={vi.fn(async () => noReadOutcome)}
      />,
    );
    expect(screen.getByTestId('step6-flag').textContent).toBe('QUALITY:LOW_CONTRAST');
    expect(screen.getByTestId('stage-illustrative-note')).toBeTruthy();
    unmount();
  });

  it('out-of-view camera: honest "no label in frame" state, no fabricated value', async () => {
    const { unmount } = render(
      <Step6SidePrep
        manifest={manifest}
        timeMs={T_STEP6}
        selectedId="cam-side-6"
        decode={vi.fn(async () => successOutcome)}
      />,
    );
    expect(screen.getByTestId('step6-prep')).toHaveAttribute(
      'data-capture-id',
      'cap-cam-6-01',
    );
    expect(screen.getByTestId('step6-no-crop').textContent).toContain(
      'No label in this frame',
    );
    // The decode stub was never called (no crop to decode) and no value
    // is shown.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('step6-value')).toBeNull();
    expect(screen.queryByTestId('step6-no-read')).toBeNull();
    unmount();
  });

  it('shows the explicit empty state outside step 6', () => {
    render(
      <Step6SidePrep
        manifest={manifest}
        timeMs={33_750}
        selectedId="cam-side-1"
        decode={vi.fn(async () => successOutcome)}
      />,
    );
    expect(screen.getByTestId('step6-no-capture')).toBeTruthy();
  });
});

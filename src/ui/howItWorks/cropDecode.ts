/**
 * Browser decode of the manifest rectified crop (display path only).
 *
 * Loads the saved `decodeCropPath` asset into a canvas, builds a
 * PixelFrame, runs the real ZXing C++ engine (Code 128) over the whole
 * rectified crop, and computes the sample-line dark/light runs. The
 * displayed value is therefore the PIXEL-DECODED one — never a
 * hard-coded manifest string (NFR-002 honesty, t3-4).
 *
 * Headless (jsdom, no canvas): callers inject a stub decoder in tests.
 */

import type { PixelFrame } from '../../pipeline/pixelDecoder';
import { zxingDecodeFrame } from '../../pipeline/zxingDecoder';
import {
  computeSampleRuns,
  type SampleLine,
} from './decodeRuns';
import type { CaptureRecord } from './replayManifest';

export interface DecodeOutcome {
  decoded: boolean;
  /** Pixel-decoded payload — only when decoded === true. */
  payload?: string;
  /** Explicit reasons when decoded === false (never fabricated). */
  reasons: string[];
  sampleLines: SampleLine[];
  widthPx: number;
  heightPx: number;
}

/** Quad covering the whole crop, inset by `marginPx` (the rectified crop
 *  IS the symbol, so a full-frame candidate is the honest search). */
export function fullCropQuad(
  widthPx: number,
  heightPx: number,
  labelInstanceId: string,
  marginPx = 4,
): { labelInstanceId: string; quadPx: [number, number][] } {
  const m = Math.min(marginPx, Math.floor(widthPx / 4), Math.floor(heightPx / 4));
  return {
    labelInstanceId,
    quadPx: [
      [m, m],
      [widthPx - m, m],
      [widthPx - m, heightPx - m],
      [m, heightPx - m],
    ],
  };
}

/** Load a PNG asset into an RGBA canvas-backed PixelFrame. */
async function loadCropFrame(path: string): Promise<PixelFrame> {
  const img = new Image();
  img.src = path;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d canvas context');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    widthPx: canvas.width,
    heightPx: canvas.height,
  };
}

/** Decode the capture's rectified crop in the browser (real ZXing). */
export async function decodeRectifiedCrop(
  capture: CaptureRecord,
): Promise<DecodeOutcome> {
  if (!capture.decodeCropPath) {
    return {
      decoded: false,
      reasons: ['ASSET:NO_DECODE_CROP'],
      sampleLines: [],
      widthPx: 0,
      heightPx: 0,
    };
  }
  const frame = await loadCropFrame(capture.decodeCropPath);
  const sampleLines = computeSampleRuns(frame, 6);
  const [result] = await zxingDecodeFrame(frame, [
    fullCropQuad(
      frame.widthPx,
      frame.heightPx,
      capture.candidate?.labelInstanceId ?? 'L',
    ),
  ]);
  return {
    decoded: result.decoded,
    payload: result.decodedPayload,
    reasons: result.reasons,
    sampleLines,
    widthPx: frame.widthPx,
    heightPx: frame.heightPx,
  };
}

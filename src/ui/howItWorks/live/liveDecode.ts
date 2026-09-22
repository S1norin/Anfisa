/**
 * Live crop decode (t7-3): the returned decodeCrop stage is decoded
 * through the EXISTING ZXing path — the same zxingDecodeFrame engine
 * the guided replay uses (cropDecode.ts), so the live value is the
 * pixel-decoded one, never a fabricated string.
 *
 * The PNG→PixelFrame step is injected (browser: canvas; headless tests:
 * the node-zlib PNG decoder from src/test/pngDecode.ts).
 */

import type { LiveStageImage } from '../../../live-processing/contracts';
import { zxingDecodeFrame } from '../../../pipeline/zxingDecoder';
import type { PixelFrame } from '../../../pipeline/pixelDecoder';
import { fullCropQuad } from '../cropDecode';

export interface LiveCropDecode {
  decoded: boolean;
  /** Pixel-decoded payload — only when decoded === true. */
  payload?: string;
  /** Explicit reasons when not decoded. */
  reasons: string[];
}

/** Decode a live decodeCrop stage with the existing ZXing engine. */
export async function decodeLiveCrop(
  stage: LiveStageImage,
  cropToFrame: (bytes: Uint8Array) => Promise<PixelFrame>,
): Promise<LiveCropDecode> {
  const frame = await cropToFrame(stage.data);
  const [result] = await zxingDecodeFrame(frame, [
    fullCropQuad(frame.widthPx, frame.heightPx, 'L-live'),
  ]);
  return {
    decoded: result.decoded,
    ...(result.decoded ? { payload: result.decodedPayload } : {}),
    reasons: result.decoded ? [] : result.reasons,
  };
}

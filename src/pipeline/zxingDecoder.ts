/**
 * ZXing C++ (WebAssembly) decode engine (t4-zxing, spike:
 * plans/report-alignment/scratch/zxing-spike.md).
 *
 * Second, real-barcode-library engine for the on-demand pixel experiment
 * (issue #17), alongside the custom TS line-scanner in `pixelDecoder.ts`.
 * The app's own bwip-js renders are decoded with production ZXing C++ —
 * useful because the custom decoder mirrors bwip's non-ISO checksum, while
 * ZXing implements the standard.
 *
 * Lazy by construction: `zxing-wasm/reader` is dynamic-imported inside
 * `loadZxing()` (Vite code-splits it), so the wasm path never touches
 * startup. The wasm binary (~1 MiB, reader subpath) is self-hosted (no CDN):
 *   - browser: `public/zxing/zxing_reader.wasm` via a `locateFile` override;
 *   - tests:   the test file injects a bootstrap (setZxingWasmBootstrap)
 *              that instantiates the wasm from `node_modules` —
 *              deterministic and offline, no network in the suite.
 *
 * Still a SYNTHETIC experiment (NFR-001): off the capture/decode hot path,
 * stamped `processingMode: 'PIXEL_DECODER'` in every result.
 */

import type {
  PixelDecodeResult,
  PixelFrame,
  PixelLabelCandidate,
} from './pixelDecoder';

type ReaderModule = typeof import('zxing-wasm/reader');
type ZxingReadResult = Awaited<ReturnType<ReaderModule['readBarcodes']>>[number];

let enginePromise: Promise<ReaderModule> | null = null;

/**
 * Wasm bootstrap seam (test-only): replaces the default `locateFile`
 * preparation with a custom one (e.g. instantiate from node_modules).
 * Must be called before the first `zxingDecodeFrame`.
 */
export function setZxingWasmBootstrap(bootstrap: (() => void | Promise<void>) | null): void {
  if (enginePromise) throw new Error('setZxingWasmBootstrap after first decode is too late');
  bootstrapRef = bootstrap;
}
let bootstrapRef: (() => void | Promise<void>) | null = null;

/**
 * Load (once) and configure the reader subpath. The first import + wasm
 * instantiate pays the cost; subsequent calls reuse the module.
 */
async function loadZxing(): Promise<ReaderModule> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const mod: ReaderModule = await import('zxing-wasm/reader');
      if (bootstrapRef) {
        await bootstrapRef();
      } else {
        // Browser: serve the wasm from public/ (self-hosted, no CDN).
        mod.prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) =>
              path.endsWith('.wasm')
                ? `${import.meta.env.BASE_URL}zxing/zxing_reader.wasm`
                : `${prefix}${path}`,
          },
        });
      }
      return mod;
    })();
  }
  return enginePromise;
}

/** Centre of the 4-corner zxing position quad. */
function resultCenter(r: ZxingReadResult): [number, number] {
  const { topLeft: a, topRight: b, bottomLeft: c, bottomRight: d } = r.position;
  return [(a.x + b.x + c.x + d.x) / 4, (a.y + b.y + c.y + d.y) / 4];
}

/** Point-in-convex-polygon (cross-product sign test; quads are convex). */
function pointInConvexQuad(p: [number, number], quad: [number, number][]): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i++) {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % quad.length];
    const cross = (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1);
    if (cross !== 0) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/**
 * Decode the frame with ZXing C++ (Code 128 only) and attach each detected
 * symbol to the candidate whose projected quad contains the symbol centre.
 *
 * Contract: same result shape as `pixelDecodeFrame` (so the comparison view
 * renders both engines identically). Confidence: 1 when the C++ reader
 * accepts the symbol (it requires `minLineCount` consistent scan lines), 0
 * otherwise — the reader exposes no partial-failure ratio.
 */
export async function zxingDecodeFrame(
  frame: PixelFrame,
  candidates: PixelLabelCandidate[],
): Promise<PixelDecodeResult[]> {
  const mod = await loadZxing();
  // Zero-copy view: PixelFrame.data (RGBA) is a valid ImageData payload.
  const data = new Uint8ClampedArray(
    frame.data.buffer,
    frame.data.byteOffset,
    frame.data.byteLength,
  );
  const results = await mod.readBarcodes(
    { data, width: frame.widthPx, height: frame.heightPx } as ImageData,
    {
      formats: ['Code128'],
      maxNumberOfSymbols: Math.max(candidates.length, 1),
    },
  );
  const used = new Set<ZxingReadResult>();
  return candidates.map((c) => {
    const match = results.find(
      (r) => !used.has(r) && pointInConvexQuad(resultCenter(r), c.quadPx),
    );
    if (match) used.add(match);
    return {
      labelInstanceId: c.labelInstanceId,
      decoded: match !== undefined,
      decodedPayload: match?.text,
      confidence: match ? 1 : 0,
      reasons: match ? [] : ['ZXING:NO_SYMBOL'],
      processingMode: 'PIXEL_DECODER',
      scanLines: match?.lineCount ?? 0,
      scanLinesDecoded: match ? match.lineCount : 0,
    };
  });
}

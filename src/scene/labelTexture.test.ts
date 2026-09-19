/**
 * PAR-006: scannable Code 128 texture with quiet zones + human-readable
 * line.
 *
 * bwip-js is the trusted encoder (its canvas output is rasterised in the
 * browser); these headless tests pin OUR usage of it — the same options
 * object the app passes to `toCanvas` — by rendering through bwip-js'
 * SVG output, which needs no canvas. Assertions:
 *   - bar paths are produced for the payload;
 *   - the first bar's left edge sits exactly `padding * scale` px in
 *     (the quiet zone);
 *   - `includetext` adds glyph paths + a text row below the bars.
 */

import * as bwipjs from 'bwip-js/node';
import { code128Options } from './labelTexture';

const PAYLOAD = 'KTY-12345678901234';
const SCALE = 4;
const QUIET = 10;

/** Bar path segments: "M<x> <y> L<x> <y>", grouped by stroke width. */
function barSegments(svg: string): { center: number; width: number }[] {
  const bars: { center: number; width: number }[] = [];
  for (const m of svg.matchAll(/stroke-width="(\d+)" d="([^"]+)"/g)) {
    const w = Number(m[1]);
    for (const mm of m[2].matchAll(/M([\d.]+) [\d.]+L/g)) {
      bars.push({ center: Number(mm[1]), width: w });
    }
  }
  return bars;
}

describe('Code 128 label texture options (PAR-006)', () => {
  it('produces bars for the payload', () => {
    const svg = bwipjs.toSVG(code128Options(PAYLOAD, { scale: SCALE, quietZoneModules: QUIET }));
    const bars = barSegments(svg);
    expect(bars.length).toBeGreaterThan(40);
    // Bars are strictly ordered and non-overlapping.
    const sorted = [...bars].sort((a, b) => a.center - b.center);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].center - sorted[i].width / 2).toBeGreaterThan(
        sorted[i - 1].center + sorted[i - 1].width / 2 - 0.5,
      );
    }
  });

  it('starts the first bar exactly one quiet zone from the left edge', () => {
    const svg = bwipjs.toSVG(code128Options(PAYLOAD, { scale: SCALE, quietZoneModules: QUIET }));
    const bars = barSegments(svg);
    const leftmost = Math.min(...bars.map((b) => b.center - b.width / 2));
    expect(leftmost).toBeCloseTo(QUIET * SCALE, 6);
  });

  it('leaves a quiet zone of the same width on the right side', () => {
    const svg = bwipjs.toSVG(code128Options(PAYLOAD, { scale: SCALE, quietZoneModules: QUIET }));
    const bars = barSegments(svg);
    const rightmost = Math.max(...bars.map((b) => b.center + b.width / 2));
    const viewBox = svg.match(/viewBox="0 0 ([\d.]+) /);
    expect(Number(viewBox![1])).toBeCloseTo(rightmost + QUIET * SCALE, 6);
  });

  it('renders the human-readable line only when requested', () => {
    // Fresh objects: bwip-js mutates the options it renders (see above).
    const withText = bwipjs.toSVG(code128Options(PAYLOAD, { scale: SCALE, quietZoneModules: QUIET }));
    const noText = bwipjs.toSVG({
      ...code128Options(PAYLOAD, { scale: SCALE, quietZoneModules: QUIET }),
      includetext: false,
    });
    const pathCount = (s: string) => (s.match(/<path/g) ?? []).length;
    const height = (s: string) => Number(s.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1]);
    // Text glyphs add at least one path and a row of height below the bars.
    expect(pathCount(withText)).toBeGreaterThan(pathCount(noText));
    expect(height(withText)).toBeGreaterThan(height(noText));
  });

  it('is deterministic for a given payload and options', () => {
    // bwip-js MUTATES the options object it is given (caches layout state
    // on it), so each render must get a fresh object — as the app does via
    // code128Options(). Reusing one object across renders inflates the
    // layout on every call.
    expect(bwipjs.toSVG(code128Options(PAYLOAD, { scale: SCALE, quietZoneModules: QUIET }))).toBe(
      bwipjs.toSVG(code128Options(PAYLOAD, { scale: SCALE, quietZoneModules: QUIET })),
    );
  });
});

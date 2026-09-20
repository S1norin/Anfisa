/**
 * Minimal type surface for bwip-js (no bundled types). Only the API the
 * pixel-decoder tests use — rendering Code 128 labels to SVG so the
 * synthetic frame generator can rasterize them.
 */
declare module 'bwip-js' {
  export interface ToSVGOptions {
    bcid: string;
    text: string;
    scale?: number;
    includetext?: boolean;
    padding?: number;
    [key: string]: unknown;
  }
  export function toSVG(options: ToSVGOptions): string;
}

/**
 * Sample lines across a rectified barcode crop: dark/light run widths.
 *
 * Pure pixel math (display path only): horizontal scan lines sampled at
 * even vertical fractions of the crop; each line is thresholded into
 * runs of dark/light pixels with widths in crop pixels. These are the
 * bar/space transitions the decoder reads — shown as image features, not
 * decoded values.
 */

import type { PixelFrame } from '../../pipeline/pixelDecoder';

export interface RunSegment {
  /** true = dark (bar), false = light (space). */
  dark: boolean;
  widthPx: number;
}

export interface SampleLine {
  /** Y of the sample line in crop pixels (0-based). */
  y: number;
  runs: RunSegment[];
}

const DARK_THRESHOLD = 128;

/** Per-pixel luminance from RGBA (ITU-R BT.601, matches the strip tests). */
function luminance(data: Uint8Array, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * Sample `sampleCount` horizontal lines (evenly spaced, first/last inset)
 * and compute the dark/light runs on each. Only lines that CROSS the
 * symbol (at least one dark bar) are returned: a line in the quiet zone
 * carries no bar/space pattern, so it is not shown.
 */
export function computeSampleRuns(
  frame: PixelFrame,
  sampleCount = 6,
): SampleLine[] {
  const { data, widthPx, heightPx } = frame;
  const n = Math.max(1, Math.min(sampleCount, heightPx));
  const lines: SampleLine[] = [];
  for (let k = 0; k < n; k++) {
    const y =
      n === 1
        ? Math.floor(heightPx / 2)
        : Math.round(((k + 0.5) / n) * heightPx);
    const runs: RunSegment[] = [];
    let runDark = luminance(data, (y * widthPx) * 4) < DARK_THRESHOLD;
    let runWidth = 0;
    for (let x = 0; x < widthPx; x++) {
      const dark = luminance(data, (y * widthPx + x) * 4) < DARK_THRESHOLD;
      if (dark === runDark) {
        runWidth += 1;
      } else {
        runs.push({ dark: runDark, widthPx: runWidth });
        runDark = dark;
        runWidth = 1;
      }
    }
    runs.push({ dark: runDark, widthPx: runWidth });
    if (!runs.some((r) => r.dark)) continue; // quiet-zone line: no bars
    lines.push({ y, runs });
  }
  return lines;
}

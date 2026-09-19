/**
 * Code 128 label textures (PAR-006) via bwip-js.
 *
 * Quiet zone: 10 modules per side (Code 128 spec, 10x the X dimension).
 * Human-readable payload line rendered below the bars.
 *
 * The app renders on a 2D canvas (browser bundle, `toCanvas`). Headless
 * tests exercise the same options object through bwip-js' SVG output
 * (no canvas needed) and assert the quiet zone + text line.
 *
 * Note: the module deliberately imports `bwip-js/browser` — the bare
 * specifier resolves to the node bundle under vitest/tsc, which lacks
 * `toCanvas`. The browser bundle also loads in node for `toSVG`.
 */

import * as bwipjs from 'bwip-js/browser';
import type * as BwipJs from 'bwip-js/browser';
import * as THREE from 'three';

export interface LabelTextureOptions {
  /** Pixels per module (default 4 → ~800 px wide for a 15-char payload). */
  scale?: number;
  /** Quiet zone in modules per side (default 10, the Code 128 spec). */
  quietZoneModules?: number;
}

/**
 * Shared options so the headless SVG tests exercise the exact app config.
 *
 * IMPORTANT: bwip-js mutates the options object it renders (it caches
 * layout state on it). Always pass a FRESH object per render — calling
 * this function per label, as the app does — never reuse one object
 * across renders.
 */
export function code128Options(
  payload: string,
  opts: LabelTextureOptions = {},
): BwipJs.RenderOptions {
  return {
    bcid: 'code128',
    text: payload,
    includetext: true, // human-readable line, centred below the bars
    textxalign: 'center',
    scale: opts.scale ?? 4,
    padding: opts.quietZoneModules ?? 10,
  };
}

export function renderCode128Canvas(
  payload: string,
  opts: LabelTextureOptions = {},
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  bwipjs.toCanvas(canvas, code128Options(payload, opts));
  return canvas;
}

export function createLabelTexture(
  payload: string,
  opts: LabelTextureOptions = {},
): THREE.CanvasTexture {
  const canvas = renderCode128Canvas(payload, opts);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

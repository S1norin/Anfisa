/**
 * Step 5: side-camera capture (t4-1) tests.
 *
 *  - scene state: the six side captures exist only during step 5, in
 *    camera order; sceneHighlightAt reports 'side-cameras'.
 *  - DOM: six manifest raw frames as thumbnails, one enlarged, chip
 *    switching changes the enlarged frame; out-of-view cameras say so.
 *  - AC3: the six fixture frames differ by viewing angle (pixel diff of
 *    two of them, plus label presence only in the label-facing angles).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildNoReadManifest, buildSuccessManifest } from './fixtures';
import { decodePngRgb } from '../../test/pngDecode';
import { sceneHighlightAt } from './step1Entry';
import {
  SIDE_CAM_ORDER,
  SideCameraCaptureHighlight,
  sideCapturesAt,
  Step5SideCameras,
  type SideCamId,
} from './step5SideCameras';

const manifest = buildSuccessManifest();

/** Step 5 spans [30000, 37500) ms of the 60 s story. */
const T_STEP5 = 33_750;

describe('sideCapturesAt (scene state: six side cameras)', () => {
  it('returns the six AREA captures in camera order during step 5', () => {
    const caps = sideCapturesAt(manifest, T_STEP5)!;
    expect(caps.map((c) => c.sensorId)).toEqual([...SIDE_CAM_ORDER]);
    expect(caps.every((c) => c.kind === 'AREA_CAMERA')).toBe(true);
    expect(caps.map((c) => c.captureId)).toEqual([
      'cap-cam-1-01',
      'cap-cam-2-01',
      'cap-cam-3-01',
      'cap-cam-4-01',
      'cap-cam-5-01',
      'cap-cam-6-01',
    ]);
  });

  it('is null outside step 5', () => {
    expect(sideCapturesAt(manifest, 26_250)).toBeNull(); // step 4
    expect(sideCapturesAt(manifest, 37_500)).toBeNull(); // step 6
    expect(sideCapturesAt(manifest, 41_250)).toBeNull(); // step 6
  });

  it('sceneHighlightAt reports side-cameras during step 5', () => {
    expect(sceneHighlightAt(manifest, T_STEP5)).toBe('side-cameras');
    expect(sceneHighlightAt(manifest, 26_250)).not.toBe('side-cameras');
    expect(sceneHighlightAt(manifest, 37_500)).not.toBe('side-cameras');
  });

  it('works for the no-read fixture too (same six cameras)', () => {
    const caps = sideCapturesAt(buildNoReadManifest(), T_STEP5)!;
    expect(caps.map((c) => c.sensorId)).toEqual([...SIDE_CAM_ORDER]);
  });
});

describe('SideCameraCaptureHighlight (3D cone emphasis)', () => {
  it('marks the selected camera in userData', () => {
    const el = SideCameraCaptureHighlight({ selectedId: 'cam-side-4' });
    expect(el.props.name).toBe('side-camera-highlight');
    expect(el.props.userData).toEqual({ selected: 'cam-side-4' });
  });
});

describe('Step5SideCameras (DOM: six frames, chip switching)', () => {
  /** Controlled harness: mirrors the layout's shared selected-camera state. */
  function Harness({ timeMs }: { timeMs: number }) {
    const [sel, setSel] = useState<SideCamId>('cam-side-1');
    return (
      <Step5SideCameras
        manifest={manifest}
        timeMs={timeMs}
        selectedId={sel}
        onSelect={setSel}
      />
    );
  }

  it('shows the six manifest raw frames as thumbnails with one enlarged', () => {
    render(<Harness timeMs={T_STEP5} />);
    const thumbs = screen.getAllByTestId(/step5-thumb-./);
    expect(thumbs).toHaveLength(6);
    const srcs = thumbs.map((t) => (t as HTMLImageElement).src);
    expect(new Set(srcs).size).toBe(6); // six distinct frames
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(
        srcs.some((s) => s.includes(`/cap-cam-${n}-01/raw.png`)),
      ).toBe(true);
    }
    const enlarged = screen.getByTestId('step5-enlarged-img') as HTMLImageElement;
    expect(enlarged.src).toContain('cap-cam-1-01/raw.png');
    expect(screen.getByTestId('step5-capture-id').textContent).toBe('cap-cam-1-01');
  });

  it('clicking a chip changes the enlarged frame', () => {
    render(<Harness timeMs={T_STEP5} />);
    fireEvent.click(screen.getByTestId('step5-chip-cam-side-3'));
    const enlarged = screen.getByTestId('step5-enlarged-img') as HTMLImageElement;
    expect(enlarged.src).toContain('cap-cam-3-01/raw.png');
    expect(screen.getByTestId('step5-capture-id').textContent).toBe('cap-cam-3-01');
    expect(screen.getByTestId('step5-chip-cam-side-3').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('step5-chip-cam-side-1').getAttribute('aria-pressed')).toBe('false');
  });

  it('label-facing cameras say "label visible"; out-of-view cameras say no label (no fabricated claim)', () => {
    render(<Harness timeMs={T_STEP5} />);
    expect(screen.getByTestId('step5-label-visible').textContent).toBe('label visible');
    fireEvent.click(screen.getByTestId('step5-chip-cam-side-6'));
    const note = screen.getByTestId('step5-label-not-visible');
    expect(note.textContent).toContain('no label in frame');
  });

  it('shows the explicit empty state outside step 5', () => {
    render(<Harness timeMs={26_250} />);
    expect(screen.getByTestId('step5-no-capture')).toBeTruthy();
  });
});

/** AC3: frames differ by viewing angle (same label at different
 *  position/tilt). Pixel diff of two of the six fixture frames. */
describe('AC3: viewing-angle variation in the fixture frames', () => {
  const ASSETS = join(process.cwd(), 'public/hiw/assets/success');

  function loadRaw(cap: string): { w: number; h: number; gray: Uint8Array } {
    const { width, height, rgb } = decodePngRgb(
      new Uint8Array(readFileSync(join(ASSETS, cap, 'raw.png'))),
    );
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      gray[i] = Math.round(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]);
    }
    return { w: width, h: height, gray };
  }

  it('cam-side-1 (label-facing) and cam-side-3 (edge-on) differ strongly', () => {
    const a = loadRaw('cap-cam-1-01');
    const b = loadRaw('cap-cam-3-01');
    expect(a.w).toBe(b.w);
    expect(a.h).toBe(b.h);
    let diff = 0;
    for (let i = 0; i < a.gray.length; i++) diff += Math.abs(a.gray[i] - b.gray[i]);
    const meanAbs = diff / a.gray.length;
    // The label (white region with bars) is present in one frame and
    // absent in the other, plus the box tilts — the frames must not be
    // near-identical. Calibrated to the generated assets: identical
    // box-at-different-angle frames differ by ~1-2 (noise + shading),
    // label-present vs label-absent by >5 (measured 5.4).
    expect(meanAbs).toBeGreaterThan(3);
  });

  it('the white label region exists only in the label-facing frames (0°/45°)', () => {
    const whiteFrac = (cap: string) => {
      const { gray } = loadRaw(cap);
      let n = 0;
      for (const v of gray) if (v > 240) n++;
      return n / gray.length;
    };
    // The 45° frame compresses the face (perspective), so it carries less
    // white than the 0° one — both must be clearly above the out-of-view
    // cameras, which see no label at all (measured: 0.0045 / 0.0019 vs 0).
    const headOn = whiteFrac('cap-cam-1-01');
    const oblique = whiteFrac('cap-cam-2-01');
    expect(headOn).toBeGreaterThan(0.002);
    expect(oblique).toBeGreaterThan(0.001);
    for (const n of [3, 4, 5, 6]) {
      const none = whiteFrac(`cap-cam-${n}-01`);
      expect(none).toBeLessThan(0.0005);
      expect(headOn).toBeGreaterThan(5 * none);
    }
  });
});

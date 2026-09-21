/**
 * Step 1: parcel entry story (t2-3).
 *
 *  - entry photoeye highlight is a pure function of the clock (scene
 *    state test — the canvas itself is verified headless in CDP);
 *  - the parcel chip populates exactly when the parcel front crosses
 *    the entry photoeye plane (playback-clock state test);
 *  - the right panel shows the explicit "acquisition arming — no image
 *    yet" state with an advancing encoder ruler, and never an image.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildSuccessManifest } from './fixtures';
import {
  Step1Entry,
  hasCrossedPhotoeye,
  sceneHighlightAt,
  PHOTOEYE_Z_MM,
} from './step1Entry';
import { PlaybackStore, stepIndexAt } from './playbackStore';

const manifest = buildSuccessManifest();

describe('hasCrossedPhotoeye (playback-clock state)', () => {
  it('is false before the crossing and true after (story pose)', () => {
    // Keyframes: t=0 front=-150, t=7500 front=-40, t=15000 front=320.
    // Crossing (front >= 0) happens between 7500 and 15000.
    expect(hasCrossedPhotoeye(manifest.keyframes, 0)).toBe(false);
    expect(hasCrossedPhotoeye(manifest.keyframes, 7500)).toBe(false);
    expect(hasCrossedPhotoeye(manifest.keyframes, 9000)).toBe(true);
    expect(hasCrossedPhotoeye(manifest.keyframes, 15000)).toBe(true);
    expect(hasCrossedPhotoeye(manifest.keyframes, 60000)).toBe(true);
  });

  it('the crossing time is the interpolated front-Z == photoeye Z', () => {
    // frontZ(t) is linear on [7500, 15000]: -40 -> 320.
    // t_cross = 7500 + (0 - (-40)) / (320 - (-40)) * 7500 = 8333.33 ms
    const a = manifest.keyframes[1];
    const b = manifest.keyframes[2];
    const tCross =
      a.tMs + ((PHOTOEYE_Z_MM - a.frontZMm) / (b.frontZMm - a.frontZMm)) * (b.tMs - a.tMs);
    expect(hasCrossedPhotoeye(manifest.keyframes, tCross - 1)).toBe(false);
    expect(hasCrossedPhotoeye(manifest.keyframes, tCross)).toBe(true);
  });
});

describe('sceneHighlightAt (scene state)', () => {
  it('highlights the entry photoeye only during step 1', () => {
    expect(sceneHighlightAt(manifest, 0)).toBe('photoeye-entry');
    expect(sceneHighlightAt(manifest, 7499)).toBe('photoeye-entry');
    expect(sceneHighlightAt(manifest, 7500)).toBe(null);
    expect(sceneHighlightAt(manifest, 59999)).toBe(null);
  });
});

describe('Step1Entry panel', () => {
  it('shows the arming state and never an image', () => {
    const { container } = render(<Step1Entry manifest={manifest} timeMs={0} />);
    expect(screen.getByTestId('step1-arming')).toHaveTextContent('no image yet');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('shows the awaiting state before the crossing', () => {
    render(<Step1Entry manifest={manifest} timeMs={1000} />);
    expect(screen.getByTestId('step1-awaiting')).toBeTruthy();
    expect(screen.queryByTestId('step1-entered')).toBeNull();
  });

  it('shows the entered state after the crossing', () => {
    render(<Step1Entry manifest={manifest} timeMs={20000} />);
    expect(screen.getByTestId('step1-entered')).toBeTruthy();
    expect(screen.queryByTestId('step1-awaiting')).toBeNull();
  });

  it('encoder value advances with the clock', () => {
    const first = render(<Step1Entry manifest={manifest} timeMs={0} />);
    expect(screen.getByTestId('step1-encoder-value')).toHaveTextContent('-150 mm');
    first.unmount();
    render(<Step1Entry manifest={manifest} timeMs={7500} />);
    expect(screen.getByTestId('step1-encoder-value')).toHaveTextContent('-40 mm');
  });
});

describe('chip population via the playback store', () => {
  it('chip text is masked before the crossing and populated after', () => {
    const store = new PlaybackStore({ fixtureId: 'success' });
    store.setDuration(manifest.durationMs);
    const step1 = stepIndexAt(manifest.steps, manifest.durationMs, 1000) + 1;
    expect(step1).toBe(1);
    // Pre-crossing: masked.
    expect(hasCrossedPhotoeye(manifest.keyframes, store.getState().timeMs)).toBe(false);
    store.scrub(20000); // post-crossing
    expect(hasCrossedPhotoeye(manifest.keyframes, store.getState().timeMs)).toBe(true);
  });
});

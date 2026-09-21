/**
 * HowItWorksView (t2-2): the guided-replay shell — 3-panel layout,
 * 8-step storyboard timeline with the line-scan / 2D-camera branch and
 * merge at step 7, one shared clock driven by the transport, the parcel
 * chip on every step, and the Guided Replay / Live Processing mode
 * switch (Live = explicit "not available yet" until P7).
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { buildSuccessManifest } from '../howItWorks/fixtures';
import { HowItWorksView } from './howItWorksView';

const STEP_MS = 7500;
const manifest = buildSuccessManifest();

function activeStep(): number {
  for (let n = 1; n <= 8; n++) {
    if (screen.getByTestId(`step-${n}`).classList.contains('story-step-active')) {
      return n;
    }
  }
  throw new Error('no active step found');
}

function scrubTo(step: number): void {
  const scrub = screen.getByTestId('scrub') as HTMLInputElement;
  fireEvent.change(scrub, { target: { value: (step - 1) * STEP_MS } });
}

beforeEach(() => {
  window.location.hash = '';
});

describe('HowItWorksView shell (t2-2)', () => {
  it('mounts #/how-it-works and is the only top-nav link (t2-1)', () => {
    window.location.hash = '#/how-it-works';
    render(<App />);
    const nav = document.querySelector('nav[aria-label="Primary"]')!;
    const labels = [...nav.querySelectorAll('li')].map((li) => li.textContent);
    expect(labels).toEqual(['How It Works']);
    expect(screen.getByTestId('how-it-works-view')).toBeTruthy();
  });

  it('renders the 3-panel shell (3D, image, timeline); jsdom gets the scene fallback', () => {
    render(<HowItWorksView />);
    expect(screen.getByTestId('hiw-3d-panel')).toBeTruthy();
    expect(screen.getByTestId('hiw-image-panel')).toBeTruthy();
    expect(screen.getByTestId('story-timeline')).toBeTruthy();
    // jsdom has no WebGL: the 3D panel degrades to the explicit fallback.
    expect(screen.getByTestId('hiw-scene-fallback')).toBeTruthy();
  });

  it('timeline: 8 numbered steps, line-scan and 2D lanes, merge at step 7', () => {
    render(<HowItWorksView />);
    for (let n = 1; n <= 8; n++) {
      expect(screen.getByTestId(`step-${n}`)).toBeTruthy();
    }
    expect(screen.getByTestId('step-3').textContent).toContain('line scan');
    expect(screen.getByTestId('step-4').textContent).toContain('line scan');
    expect(screen.getByTestId('step-5').textContent).toContain('2D camera');
    expect(screen.getByTestId('step-6').textContent).toContain('2D camera');
    expect(screen.getByTestId('step-7').textContent).toContain('merge');
    // Step 1 is active at t=0.
    expect(activeStep()).toBe(1);
  });

  it('parcel chip: masked until the entry crossing, then populated for every later step', () => {
    render(<HowItWorksView />);
    const chip = screen.getByTestId('parcel-chip');
    // Steps 1-2: parcel front is still short of the entry photoeye (z=0).
    scrubTo(1);
    expect(chip).toHaveTextContent('awaiting entry');
    scrubTo(2);
    expect(chip).toHaveTextContent('awaiting entry');
    // From step 3 on (front past z=0) the chip carries the parcel id.
    for (let n = 3; n <= 8; n++) {
      scrubTo(n);
      expect(chip).toHaveTextContent(manifest.parcel.parcelId);
    }
  });

  it('step 1: right panel shows the arming state with encoder ruler and no image', () => {
    render(<HowItWorksView />);
    scrubTo(1);
    expect(screen.getByTestId('step1-entry')).toBeTruthy();
    expect(screen.getByTestId('step1-arming')).toHaveTextContent('no image yet');
    expect(screen.getByTestId('step1-encoder-ruler')).toBeTruthy();
    expect(screen.queryByTestId('image-panel-capture')).toBeNull();
  });

  it('transport: step-fwd/restart/scrub drive the shared clock', () => {
    render(<HowItWorksView />);
    expect(activeStep()).toBe(1);
    fireEvent.click(screen.getByTestId('ctrl-step-fwd'));
    expect(activeStep()).toBe(2);
    fireEvent.click(screen.getByTestId('ctrl-step-fwd'));
    expect(activeStep()).toBe(3);
    fireEvent.click(screen.getByTestId('ctrl-restart'));
    expect(activeStep()).toBe(1);
    scrubTo(5);
    expect(activeStep()).toBe(5);
    // The image panel follows the clock: step 5 is the side-camera capture
    // (t4-1) — default selection is cam-side-1.
    expect(screen.getByTestId('step5-side')).toHaveAttribute(
      'data-capture-id',
      'cap-cam-1-01',
    );
    // Step 1 has no capture.
    scrubTo(1);
    expect(screen.queryByTestId('image-panel-capture')).toBeNull();
  });

  it('step 2: line-scan strip appends rows in encoder order with a synced ruler (t3-1)', () => {
    render(<HowItWorksView />);
    const scrub = screen.getByTestId('scrub') as HTMLInputElement;
    const setT = (t: number) => {
      fireEvent.change(scrub, { target: { value: t } });
    };
    const rows = (): number =>
      Number(screen.getByTestId('hiw-strip-canvas').getAttribute('data-visible-rows'));
    const markerLeft = (): string =>
      screen.getByTestId('hiw-strip-ruler-marker').style.left;

    // Step 2 start (t=7500, front=-40): the strip is shown, nothing acquired.
    setT(7500);
    expect(screen.getByTestId('hiw-strip')).toBeTruthy();
    expect(rows()).toBe(0);
    expect(markerLeft()).toBe('0%');

    // Mid step 2 (t=13750, front=260): half the rows, marker at 50%.
    setT(13750);
    expect(rows()).toBe(280);
    expect(markerLeft()).toBe('50%');
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent('280 / 560 rows');
    // The scanline (current row) tracks the same fraction on the strip.
    expect(screen.getByTestId('hiw-strip-scanline').style.top).toBe('50%');

    // Last in-step value (t=14990, front≈319.5): the strip is nearly complete.
    setT(14990);
    expect(rows()).toBe(557);
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent('557 / 560 rows');
    const scanTop = Number(
      screen.getByTestId('hiw-strip-scanline').style.top.slice(0, -1),
    );
    expect(scanTop).toBeCloseTo(99.6, 0);

    // Step 3 (t≥15000): the preparation stages replace the strip view.
    setT(15000);
    expect(screen.getByTestId('stage-panel')).toBeTruthy();
    expect(screen.queryByTestId('hiw-strip')).toBeNull();

    // Step 4 (decode, same capture): the decode panel replaces the strip.
    setT(26000);
    expect(screen.getByTestId('step4-decode')).toBeTruthy();
    expect(screen.queryByTestId('hiw-strip')).toBeNull();
    expect(screen.queryByTestId('hiw-strip-scanline')).toBeNull();

    // Area-camera steps keep the placeholder, not the strip.
    setT(37500);
    expect(screen.queryByTestId('hiw-strip')).toBeNull();
    expect(screen.getByTestId('image-panel-capture')).toHaveTextContent('cap-cam-1-01');
  });

  it('step 2: current 1D line + top/bottom 2D strips, bottom gap-clipped (t3-2)', () => {
    render(<HowItWorksView />);
    const scrub = screen.getByTestId('scrub') as HTMLInputElement;
    const setT = (t: number) => {
      fireEvent.change(scrub, { target: { value: t } });
    };
    setT(7500);
    expect(screen.getByTestId('step2-capture')).toBeTruthy();
    expect(screen.getByTestId('step2-current-row')).toHaveAttribute(
      'data-active',
      'false',
    );
    expect(screen.getByTestId('step2-top-strip-block')).toBeTruthy();
    expect(screen.getByTestId('step2-bottom-strip-block')).toBeTruthy();
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent(
      '0 / 560 rows',
    );
    setT(13750);
    expect(screen.getByTestId('step2-current-row')).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.getByTestId('step2-current-row-value')).toHaveTextContent('row 279');
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent(
      '280 / 560 rows',
    );
    // Last in-step scrub value: both strips nearly complete…
    setT(14990);
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent(
      '557 / 560 rows',
    );
    // …and at the step boundary the capture view is replaced by the
    // preparation stages.
    setT(15000);
    expect(screen.queryByTestId('step2-capture')).toBeNull();
    expect(screen.getByTestId('stage-panel')).toBeTruthy();
  });

  it('step 3: all six preparation stages render as manifest images (t3-3)', () => {
    render(<HowItWorksView />);
    const scrub = screen.getByTestId('scrub') as HTMLInputElement;
    const setT = (t: number) => {
      fireEvent.change(scrub, { target: { value: t } });
    };
    setT(18750);
    const panel = screen.getByTestId('stage-panel');
    expect(panel).toHaveAttribute('data-capture-id', 'cap-ls-top-01');
    for (const stage of [
      'raw',
      'maskedCrop',
      'grayscaleContrast',
      'edgeMap',
      'candidateOverlay',
      'rectifiedCrop',
    ]) {
      const tile = screen.getByTestId(`stage-tile-${stage}`);
      expect(tile).toHaveAttribute('data-capture-id', 'cap-ls-top-01');
      const img = tile.querySelector('img') as HTMLImageElement;
      expect(img.src).toContain(`/hiw/assets/success/cap-ls-top-01/${stage}.png`);
    }
  });

  it('step 5: six side-camera frames as chips, switching changes the enlarged frame (t4-1)', () => {
    render(<HowItWorksView />);
    scrubTo(5);
    const panel = screen.getByTestId('step5-side');
    expect(panel).toBeTruthy();
    const thumbs = screen.getAllByTestId(/step5-thumb-cam-side-./);
    expect(thumbs).toHaveLength(6);
    expect((screen.getByTestId('step5-enlarged-img') as HTMLImageElement).src).toContain(
      '/hiw/assets/success/cap-cam-1-01/raw.png',
    );
    fireEvent.click(screen.getByTestId('step5-chip-cam-side-5'));
    expect((screen.getByTestId('step5-enlarged-img') as HTMLImageElement).src).toContain(
      '/hiw/assets/success/cap-cam-5-01/raw.png',
    );
    // out-of-view camera: honest "no label" note, no fabricated claim
    expect(screen.getByTestId('step5-label-not-visible')).toBeTruthy();
  });

  it('mode switch: live shows the unavailable placeholder; guided stays usable', () => {
    render(<HowItWorksView />);
    expect(screen.getByTestId('mode-guided')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByTestId('mode-live'));
    expect(screen.getByTestId('mode-live')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('live-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('hiw-3d-panel')).toBeNull();
    expect(screen.queryByTestId('story-timeline')).toBeNull();
    fireEvent.click(screen.getByTestId('mode-guided'));
    expect(screen.getByTestId('hiw-3d-panel')).toBeTruthy();
    expect(screen.getByTestId('story-timeline')).toBeTruthy();
    expect(screen.queryByTestId('live-unavailable')).toBeNull();
  });

  it('fixture switch restarts the clock and swaps the story parcel', () => {
    render(<HowItWorksView />);
    scrubTo(4);
    expect(activeStep()).toBe(4);
    fireEvent.change(screen.getByTestId('fixture-select'), {
      target: { value: 'no-read' },
    });
    // Clock restarts at t=0: chip masked again, step 1 active.
    expect(activeStep()).toBe(1);
    expect(screen.getByTestId('parcel-chip')).toHaveTextContent(
      'awaiting entry',
    );
    scrubTo(3);
    expect(screen.getByTestId('parcel-chip')).toHaveTextContent(
      'PARCEL-2026-0002',
    );
  });
});

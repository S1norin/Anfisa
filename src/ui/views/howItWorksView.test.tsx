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

  it('parcel chip shows the story parcel on every step', () => {
    render(<HowItWorksView />);
    const chip = screen.getByTestId('parcel-chip');
    for (let n = 1; n <= 8; n++) {
      scrubTo(n);
      expect(chip).toHaveTextContent(manifest.parcel.parcelId);
    }
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
    // The image panel follows the clock: step 5 is the side-camera capture.
    expect(screen.getByTestId('image-panel-capture')).toHaveTextContent(
      'cap-cam-1-01',
    );
    // Step 1 has no capture.
    scrubTo(1);
    expect(screen.queryByTestId('image-panel-capture')).toBeNull();
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
    expect(screen.getByTestId('parcel-chip')).toHaveTextContent(
      'PARCEL-2026-0002',
    );
    expect(activeStep()).toBe(1);
  });
});

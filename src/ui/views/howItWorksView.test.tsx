/**
 * HowItWorksView (t12): route + nav order, step rail (11 buttons,
 * aria-current, Left/Right keys), parcel selector (follow-newest default,
 * switch to an older parcel), sim invariance across navigation, and the
 * technical-details / accuracy-callout disclosures.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { simStore } from '../../store/simStore';
import { PROCESS_GUIDE } from '../process/processGuide';
import { HowItWorksView } from './howItWorksView';

const PARCELS_NEEDED = 2;

function seedParcels(n: number): void {
  simStore.reset();
  simStore.start();
  let guard = 0;
  while (simStore.sim.state.parcels.size < n && guard++ < 5000) {
    simStore.tick(16);
  }
  simStore.pause();
}

beforeEach(() => {
  simStore.reset();
  window.location.hash = '';
});

describe('HowItWorksView (t12)', () => {
  it('adds the 5th nav item after Operations and mounts #/how-it-works', () => {
    window.location.hash = '#/how-it-works';
    render(<App />);
    const nav = document.querySelector('nav[aria-label="Primary"]')!;
    const labels = [...nav.querySelectorAll('li')].map(
      (li) => li.textContent,
    );
    expect(labels).toEqual([
      'Operations',
      'Camera Lab',
      'Schema',
      'How It Works',
      'Metrics',
    ]);
    expect(screen.getByTestId('how-it-works-view')).toBeTruthy();
  });

  it('step rail: 11 real buttons; current step carries aria-current="step"', () => {
    render(<HowItWorksView />);
    const buttons = screen.getAllByRole('button');
    const stepButtons = buttons.filter((b) =>
      PROCESS_GUIDE.some((s) => b.dataset.testid === `step-${s.id}`),
    );
    expect(stepButtons).toHaveLength(PROCESS_GUIDE.length);
    expect(stepButtons.every((b) => b.tagName === 'BUTTON')).toBe(true);
    expect(
      screen.getByTestId(`step-${PROCESS_GUIDE[0].id}`),
    ).toHaveAttribute('aria-current', 'step');
  });

  it('step rail: Left/Right arrow keys move to prev/next', () => {
    render(<HowItWorksView />);
    const rail = screen.getByTestId('process-step-rail');
    // Starts at step 1 (index 0): ArrowRight → index 1, ArrowLeft → index 0.
    fireEvent.keyDown(rail, { key: 'ArrowRight' });
    expect(
      screen.getByTestId(`step-${PROCESS_GUIDE[1].id}`),
    ).toHaveAttribute('aria-current', 'step');
    fireEvent.keyDown(rail, { key: 'ArrowLeft' });
    expect(
      screen.getByTestId(`step-${PROCESS_GUIDE[0].id}`),
    ).toHaveAttribute('aria-current', 'step');
  });

  it('parcel selector defaults to follow-newest and shows the newest parcel', () => {
    seedParcels(PARCELS_NEEDED);
    const parcels = [...simStore.sim.state.parcels.values()];
    render(<HowItWorksView />);
    const select = screen.getByTestId('parcel-select') as HTMLSelectElement;
    expect(select.value).toBe('__follow_newest__');
    expect(screen.getByTestId('evidence-parcel')).toHaveTextContent(
      parcels[parcels.length - 1].parcelId,
    );
  });

  it('selecting an older parcel switches the evidence cards to it', () => {
    seedParcels(PARCELS_NEEDED);
    const parcels = [...simStore.sim.state.parcels.values()];
    const older = parcels[0].parcelId;
    render(<HowItWorksView />);
    fireEvent.change(screen.getByTestId('parcel-select'), {
      target: { value: older },
    });
    expect(screen.getByTestId('evidence-parcel')).toHaveTextContent(older);
    // The first stage (created) is complete for every spawned parcel.
    expect(screen.getByTestId('evidence-created')).toHaveAttribute(
      'data-status',
      'complete',
    );
  });

  it('navigating to and from the view does not mutate the simulation', () => {
    seedParcels(1);
    const versionBefore = simStore.getState().version;
    window.location.hash = '#/how-it-works';
    const { unmount } = render(<App />);
    unmount();
    expect(simStore.getState().version).toBe(versionBefore);
  });

  it('technical details disclosure and accuracy callout render', () => {
    render(<HowItWorksView />);
    expect(screen.getByTestId('accuracy-callout')).toBeTruthy();
    const toggle = screen.getByTestId('technical-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('technical-details')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByTestId('technical-details')).toBeTruthy();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('running/paused indicator reflects the sim status', () => {
    seedParcels(1); // ends paused
    render(<HowItWorksView />);
    expect(screen.getByTestId('run-indicator')).toHaveTextContent('paused');
    act(() => {
      simStore.start();
    });
    expect(screen.getByTestId('run-indicator')).toHaveTextContent('running');
  });
});

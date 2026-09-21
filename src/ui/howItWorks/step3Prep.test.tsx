/**
 * Step 3: line-scan preparation stages (t3-3).
 *
 *  - all 6 stages render as real manifest images with operation labels;
 *  - every tile carries the same captureId as the current capture;
 *  - candidate.source != 'pixels' → 'illustrative candidate location'.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STAGE_ORDER } from './replayManifest';
import { buildNoReadManifest, buildSuccessManifest } from './fixtures';
import { StagePanel, STAGE_LABELS, ILLUSTRATIVE_NOTE } from './stagePanel';
import { Step3Prep, step3Capture } from './step3Prep';

const manifest = buildSuccessManifest();
const capture = manifest.captures.find((c) => c.kind === 'LINE_SCAN')!;

describe('step3Capture', () => {
  it('resolves the line-scan capture during step 3', () => {
    expect(step3Capture(manifest, 18750)?.captureId).toBe('cap-ls-top-01');
  });

  it('undefined outside the line-scan steps (step 1 has no capture)', () => {
    expect(step3Capture(manifest, 0)).toBeUndefined();
    expect(step3Capture(manifest, 37500)).toBeUndefined(); // step 5: area frame
  });
});

describe('Step3Prep (all 6 stages as real manifest images)', () => {
  it('renders one tile per stage, in display order, with operation labels', () => {
    render(<Step3Prep manifest={manifest} timeMs={18750} />);
    const panel = screen.getByTestId('stage-panel');
    // In display order.
    expect(
      STAGE_ORDER.map((s) => screen.getByTestId(`stage-tile-${s}`)),
    ).toEqual(
      Array.from(panel.querySelectorAll('[data-testid^=stage-tile-]')),
    );
    for (const stage of STAGE_ORDER) {
      const img = screen.getByTestId(`stage-img-${stage}`) as HTMLImageElement;
      const path = capture.stages.find((s) => s.stage === stage)!.path;
      expect(img.src).toBe(new URL(path, window.location.href).href);
      expect(screen.getByTestId(`stage-tile-${stage}`).textContent).toContain(
        STAGE_LABELS[stage],
      );
    }
  });

  it('frames the edge map as image features, not decoded values', () => {
    render(<Step3Prep manifest={manifest} timeMs={18750} />);
    const edgeTile = screen.getByTestId('stage-tile-edgeMap');
    expect(edgeTile.textContent).toContain('Transitions only');
  });

  it('every tile carries the capture id of the current capture', () => {
    render(<Step3Prep manifest={manifest} timeMs={18750} />);
    const panel = screen.getByTestId('stage-panel');
    expect(panel).toHaveAttribute('data-capture-id', capture.captureId);
    for (const tile of Array.from(
      panel.querySelectorAll('[data-testid^=stage-tile-]'),
    )) {
      expect(tile).toHaveAttribute('data-capture-id', capture.captureId);
    }
  });
});

describe('illustrative candidate location (honesty label, NFR-002)', () => {
  it('labeled when candidate.source is geometry (no-read fixture, cap-cam-2-01)', () => {
    const flagged = buildNoReadManifest().captures.find(
      (c) => c.captureId === 'cap-cam-2-01',
    )!;
    expect(flagged.candidate?.source).toBe('geometry');
    render(<StagePanel capture={flagged} />);
    const note = screen.getByTestId('stage-illustrative-note');
    expect(note).toHaveTextContent(ILLUSTRATIVE_NOTE);
    const overlayTile = screen.getByTestId('stage-tile-candidateOverlay');
    expect(overlayTile.contains(note)).toBe(true);
  });

  it('labeled when candidate.source is manual', () => {
    const flagged = { ...capture, candidate: { ...capture.candidate!, source: 'manual' as const } };
    render(<StagePanel capture={flagged} />);
    expect(screen.getByTestId('stage-illustrative-note')).toHaveTextContent(
      ILLUSTRATIVE_NOTE,
    );
  });

  it('not labeled for pixel-derived candidates (success line scan)', () => {
    expect(capture.candidate?.source).toBe('pixels');
    render(<StagePanel capture={capture} />);
    expect(screen.queryByTestId('stage-illustrative-note')).toBeNull();
  });
});

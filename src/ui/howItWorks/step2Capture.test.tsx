/**
 * Step 2: line-scan capture view (t3-2).
 *
 *  - bottomExposedZRange / bottomStripRowRange: gap-geometry state tests
 *    (the bottom strip contains only rows where the gap exposes the
 *    underside);
 *  - lineScanGlowActive / lineScanHighlightAt / sceneHighlightAt: the
 *    cross-belt scan planes glow exactly while the box crosses the
 *    line-scan section (scene state);
 *  - Step2Capture / BottomStripView: one thin 1D row first, then rows
 *    appended in encoder order into the 2D top/bottom strips, markers in
 *    sync with the box position.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../domain/config';
import { HIW_STRIP } from '../../capture/stripPreview';
import { buildSuccessManifest } from './fixtures';
import {
  BottomStripView,
  Step2Capture,
  bottomExposedZRange,
  bottomStripRowRange,
  lineScanGlowActive,
  lineScanHighlightAt,
} from './step2Capture';
import { sceneHighlightAt } from './step1Entry';

const manifest = buildSuccessManifest();
const capture = manifest.captures.find((c) => c.kind === 'LINE_SCAN')!;
const TOTAL = HIW_STRIP.rows;

describe('bottomExposedZRange (gap geometry)', () => {
  it('SIDE_GRIP: the whole transfer zone exposes the underside', () => {
    const cfg = defaultConfig();
    expect(cfg.station.bottomTransfer).toBe('SIDE_GRIP');
    expect(bottomExposedZRange(cfg)).toEqual([0, cfg.station.lengthMm]);
  });

  it('GAP: only the 100 mm opening centred on the station', () => {
    const cfg = {
      ...defaultConfig(),
      station: { ...defaultConfig().station, bottomTransfer: 'GAP' as const },
    };
    const mid = cfg.station.lengthMm / 2;
    expect(bottomExposedZRange(cfg)).toEqual([mid - 50, mid + 50]);
  });
});

describe('bottomStripRowRange (state test against gap geometry)', () => {
  const [z0, z1] = capture.encoderSpanMm; // [200, 320]

  it('SIDE_GRIP (fully exposed span): all rows', () => {
    expect(bottomStripRowRange(z0, z1, 0, 2200)).toEqual({
      fromRow: 0,
      rowCount: TOTAL,
    });
  });

  it('GAP far from the span: no rows', () => {
    expect(bottomStripRowRange(z0, z1, 1050, 1150)).toEqual({
      fromRow: 0,
      rowCount: 0,
    });
  });

  it('GAP inside the span: the exposed window only', () => {
    // span [1000, 1200], exposed [1050, 1150] → rows 140..420
    expect(bottomStripRowRange(1000, 1200, 1050, 1150)).toEqual({
      fromRow: 140,
      rowCount: 280,
    });
  });

  it('span overhanging the exposed zone edge: clipped', () => {
    // span [2100, 2300], exposed [0, 2200] → first half only
    expect(bottomStripRowRange(2100, 2300, 0, 2200)).toEqual({
      fromRow: 0,
      rowCount: 280,
    });
  });
});

describe('lineScanGlowActive (scene state: box crossing the section)', () => {
  it('inactive before the front enters the span start (z0=200)', () => {
    expect(lineScanGlowActive(capture, -40)).toBe(false);
    expect(lineScanGlowActive(capture, 200)).toBe(false);
    expect(lineScanGlowActive(capture, 201)).toBe(true);
  });

  it('active while the box overlaps the section, inactive after the rear clears', () => {
    // Box = [front - 350, front]; rear clears z1=320 when front > 670.
    expect(lineScanGlowActive(capture, 260)).toBe(true);
    expect(lineScanGlowActive(capture, 320)).toBe(true);
    expect(lineScanGlowActive(capture, 669)).toBe(true);
    expect(lineScanGlowActive(capture, 670)).toBe(false);
    expect(lineScanGlowActive(capture, 1400)).toBe(false);
  });
});

describe('lineScanHighlightAt / sceneHighlightAt (scene state at story time)', () => {
  it('no highlight during step 1 (box short of the section)', () => {
    expect(lineScanHighlightAt(manifest, 0)).toBeNull();
    expect(lineScanHighlightAt(manifest, 7500)).toBeNull();
  });

  it('the line-scan highlight starts exactly at the crossing (front > z0)', () => {
    // front(t) = -40 + (t-7500)/7500*360 → front=200 at t=12500
    expect(lineScanHighlightAt(manifest, 12500)).toBeNull();
    expect(lineScanHighlightAt(manifest, 12501)?.captureId).toBe('cap-ls-top-01');
  });

  it('stays active while the box is inside the section (steps 2-4)', () => {
    for (const t of [13750, 15000, 20000, 26000]) {
      expect(lineScanHighlightAt(manifest, t)?.captureId).toBe('cap-ls-top-01');
    }
  });

  it('off during the 2D-camera steps (their capture is not a line scan)', () => {
    expect(lineScanHighlightAt(manifest, 37500)).toBeNull();
    expect(lineScanHighlightAt(manifest, 60000 - 1)).toBeNull();
  });

  it('sceneHighlightAt reports line-scan at the crossing and photoeye in step 1', () => {
    expect(sceneHighlightAt(manifest, 0)).toBe('photoeye-entry');
    expect(sceneHighlightAt(manifest, 7500)).toBeNull(); // pre-crossing
    expect(sceneHighlightAt(manifest, 13750)).toBe('line-scan');
    // 37500 is the step 6 boundary — the frozen-pose highlight is active
    // (just before, step 5's side-camera highlight is).
    expect(sceneHighlightAt(manifest, 37_499)).toBe('side-cameras');
    expect(sceneHighlightAt(manifest, 37_500)).toBe('side-prep-frozen');
  });
});

describe('Step2Capture (playback state: 1D row first, then 2D strips)', () => {
  it('before the scan: awaiting state, no rows on either strip', () => {
    render(<Step2Capture manifest={manifest} timeMs={7500} />);
    const current = screen.getByTestId('step2-current-row');
    expect(current).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('step2-current-row-value')).toHaveTextContent(
      'awaiting scan',
    );
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent('0 / 560 rows');
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent('0 / 560 rows');
  });

  it('first row: the thin 1D line is active with row 0', () => {
    // front(t)=200+... first row at t=12505 (front≈200.24)
    render(<Step2Capture manifest={manifest} timeMs={12505} />);
    const current = screen.getByTestId('step2-current-row');
    expect(current).toHaveAttribute('data-active', 'true');
    expect(current).toHaveAttribute('data-row-index', '0');
    expect(screen.getByTestId('step2-current-row-value')).toHaveTextContent('row 0');
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent('1 / 560 rows');
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent('1 / 560 rows');
  });

  it('mid scan: rows appended in encoder order, markers at 50%', () => {
    render(<Step2Capture manifest={manifest} timeMs={13750} />);
    expect(screen.getByTestId('step2-current-row-value')).toHaveTextContent('row 279');
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent('280 / 560 rows');
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent(
      '280 / 560 rows',
    );
    expect(screen.getByTestId('hiw-strip-ruler-marker').style.left).toBe('50%');
    expect(screen.getByTestId('hiw-strip-bottom-ruler-marker').style.left).toBe('50%');
    expect(screen.getByTestId('hiw-strip-scanline').style.top).toBe('50%');
  });

  it('scan complete: both strips full, current line no longer active', () => {
    render(<Step2Capture manifest={manifest} timeMs={15000} />);
    expect(screen.getByTestId('step2-current-row')).toHaveAttribute(
      'data-active',
      'false',
    );
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent('560 / 560 rows');
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent(
      '560 / 560 rows',
    );
    expect(screen.queryByTestId('hiw-strip-scanline')).toBeNull();
    expect(screen.queryByTestId('hiw-strip-bottom-scanline')).toBeNull();
  });

  it('rows grow monotonically with the clock', () => {
    const { rerender } = render(<Step2Capture manifest={manifest} timeMs={7500} />);
    const read = () =>
      Number(
        screen.getByTestId('hiw-strip-canvas').getAttribute('data-visible-rows'),
      );
    const bottom = () =>
      Number(
        screen.getByTestId('hiw-strip-bottom-canvas').getAttribute('data-visible-rows'),
      );
    let topPrev = 0;
    let bottomPrev = 0;
    for (const t of [12505, 13125, 13750, 14375, 15000, 20000]) {
      rerender(<Step2Capture manifest={manifest} timeMs={t} />);
      expect(read()).toBeGreaterThanOrEqual(topPrev);
      expect(bottom()).toBeGreaterThanOrEqual(bottomPrev);
      topPrev = read();
      bottomPrev = bottom();
    }
    expect(topPrev).toBe(TOTAL);
    expect(bottomPrev).toBe(TOTAL);
  });
});

describe('BottomStripView (gap-clipped rows)', () => {
  it('SIDE_GRIP: identical row count to the top strip', () => {
    render(
      <BottomStripView
        capture={capture}
        exposedRange={bottomExposedZRange(defaultConfig())}
        frontZMm={260}
      />,
    );
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent(
      '280 / 560 rows',
    );
  });

  it('GAP far from the span: no rows at all', () => {
    render(
      <BottomStripView
        capture={capture}
        exposedRange={[1050, 1150]}
        frontZMm={260}
      />,
    );
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent(
      '0 / 0 rows',
    );
    expect(screen.getByTestId('hiw-strip-bottom-canvas')).toHaveAttribute(
      'data-visible-rows',
      '0',
    );
  });

  it('GAP inside the span: only the exposed window, at its encoder offset', () => {
    const overhanging = { ...capture, encoderSpanMm: [2100, 2300] as [number, number] };
    render(
      <BottomStripView
        capture={overhanging}
        exposedRange={[0, 2200]}
        frontZMm={2300}
      />,
    );
    expect(screen.getByTestId('hiw-strip-bottom-rows')).toHaveTextContent(
      '280 / 280 rows',
    );
  });
});

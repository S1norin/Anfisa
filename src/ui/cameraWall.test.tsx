/**
 * Camera wall line-scanner tiles (t9): the strip reconstruction renders
 * encoder-mapped (canvas dimensions = display cols × encoder lines) and
 * carries the 'Line scanner reconstruction' label. Area tiles are
 * unchanged (metadata-only, NFR-002).
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { reportEightReaderConfig, reportSixViewConfig } from '../capture/presets';
import { stripBufferPool } from '../capture/frameBuffer';
import { buildStripTexture } from '../capture/stripPreview';
import type { LineScanCameraConfig } from '../domain/types';
import { simStore } from '../store/simStore';
import { CameraWall } from './cameraWall';

const TOP_ID = 'CAM-005'; // reportSixViewConfig TOP line scanner
const BOTTOM_ID = 'CAM-006';

beforeEach(() => {
  simStore.reset(reportSixViewConfig());
  stripBufferPool.clear();
});

describe('camera wall line-scanner tiles (t9)', () => {
  it('renders the strip preview labeled "Line scanner reconstruction"', () => {
    const cfg = reportSixViewConfig();
    const rig = cfg.cameraRigs.find((r): r is LineScanCameraConfig => r.id === TOP_ID)!;
    expect(rig.kind).toBe('LINE_SCAN');
    stripBufferPool.push(
      buildStripTexture({
        rig,
        parcelId: 'P-0001',
        simTimeMs: 5000,
        strip: {
          encoderStartMm: 1300,
          encoderEndMm: 1800,
          lineCount: 5000,
          expectedLineCount: 5000,
          complete: true,
        },
        beltSpeedMmPerSec: 1500,
        seed: cfg.seed,
      }),
    );

    render(<CameraWall />);

    expect(screen.getByTestId(`cam-tile-strip-${TOP_ID}`)).toBeTruthy();
    expect(
      screen.getByTestId(`cam-tile-strip-label-${TOP_ID}`).textContent,
    ).toBe('Line scanner reconstruction');
    const canvas = screen.getByTestId(
      `cam-tile-strip-canvas-${TOP_ID}`,
    ) as HTMLCanvasElement;
    // Encoder-mapped: 320 display cols × 5000 encoder lines (0.1 mm/line).
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(5000);
  });

  it('shows the strip block on line rigs only', () => {
    render(<CameraWall />);
    expect(screen.queryByTestId(`cam-tile-strip-${BOTTOM_ID}`)).toBeTruthy();
    expect(screen.queryByTestId('cam-tile-strip-CAM-001')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// t3-wall: the wall is responsive to N readers — the final-report layout
// (6 side area readers + 2 line scanners) reflows without overflow.
// ---------------------------------------------------------------------------
describe('camera wall: eight-reader report layout (t3-wall)', () => {
  beforeEach(() => {
    simStore.reset(reportEightReaderConfig());
    stripBufferPool.clear();
  });

  it('renders one feed tile per reader: 6 area + 2 line', () => {
    render(<CameraWall />);
    const wall = screen.getByTestId('camera-wall');
    const tiles = Array.from(wall.querySelectorAll('.cam-tile'));
    expect(tiles).toHaveLength(8);
    for (let i = 1; i <= 8; i++) {
      expect(
        screen.getByTestId(`cam-tile-CAM-${String(i).padStart(3, '0')}`),
      ).toBeTruthy();
    }
  });

  it('captions show the reader name + kind', () => {
    render(<CameraWall />);
    const side = screen.getByTestId('cam-tile-caption-CAM-002');
    expect(side.textContent).toContain('Side reader · RIGHT 90°');
    expect(side.textContent).toContain('AREA');
    const line = screen.getByTestId('cam-tile-caption-CAM-007');
    expect(line.textContent).toContain('line scanner');
    expect(line.textContent).toContain('LINE');
  });

  it('never overflows the container (reflows 4×2 at the presentation viewport)', () => {
    render(<CameraWall />);
    const wall = screen.getByTestId('camera-wall');
    // Responsive grid (auto-fill + min(215px, 100%)): tiles shrink to fit
    // the container width, so 8 readers reflow into rows instead of
    // clipping. Measured in a real browser at t6-gates.
    expect(wall.classList.contains('camera-wall')).toBe(true);
    expect(wall.scrollWidth).toBeLessThanOrEqual(wall.clientWidth + 1);
  });
});

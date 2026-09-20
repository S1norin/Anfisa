/**
 * Camera wall line-scanner tiles (t9): the strip reconstruction renders
 * encoder-mapped (canvas dimensions = display cols × encoder lines) and
 * carries the 'Line scanner reconstruction' label. Area tiles are
 * unchanged (metadata-only, NFR-002).
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { reportSixViewConfig } from '../capture/presets';
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

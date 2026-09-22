/**
 * Live event strip tests (t7-3, sub-task s3).
 *
 * The strip derives from ONE newest result: all six nodes share the
 * captureId; failed reads surface their explicit no-read reason and
 * never a fabricated value.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LiveProcessingResult } from '../../../live-processing/contracts';
import { deriveLiveEvents, LiveEventStrip } from './eventStrip';

function result(over: Partial<LiveProcessingResult> = {}): LiveProcessingResult {
  return {
    captureId: 'cam-side-1-live-7',
    seq: 7,
    cameraId: 'cam-side-1',
    sourceType: 'AREA_FRAME',
    simTimeMs: 700,
    encoderSpanMm: [120, 132],
    stages: [
      { name: 'maskedCrop', data: new Uint8Array([1]), mime: 'image/png', width: 2, height: 2 },
    ],
    candidate: { quadPx: [[1, 2], [3, 2], [3, 4], [1, 4]] as [number, number][], source: 'pixels' },
    decode: { decoded: false, pending: true, reasons: [], confidence: 0 },
    processingMs: 42,
    ...over,
  };
}

describe('deriveLiveEvents', () => {
  it('idle until a result exists', () => {
    const nodes = deriveLiveEvents(null, null, 'PKG-1');
    expect(nodes.map((n) => n.state)).toEqual(['idle', 'idle', 'idle', 'idle', 'idle', 'idle']);
  });

  it('decoded read: all six nodes done, final shows the pixel-decoded value', () => {
    const nodes = deriveLiveEvents(result(), { decoded: true, payload: 'PKG-1-A', reasons: [] }, 'PKG-1');
    expect(nodes.map((n) => n.name)).toEqual([
      'capture', 'preprocessing', 'candidate', 'decode', 'association', 'final',
    ]);
    expect(nodes.every((n) => n.state === 'done')).toBe(true);
    expect(nodes[0].detail).toBe('cam-side-1-live-7');
    expect(nodes[4].detail).toBe('→ PKG-1');
    expect(nodes[5].detail).toBe('PKG-1-A');
  });

  it('no-read: explicit reason on decode+final, no value fabricated', () => {
    const r = result({
      candidate: undefined,
      decode: { decoded: false, reasons: ['QUALITY:GLARE'], confidence: 0 },
    });
    const nodes = deriveLiveEvents(r, null, 'PKG-1');
    expect(nodes[2].state).toBe('idle');
    expect(nodes[2].detail).toBe('no candidate');
    expect(nodes[3].state).toBe('failed');
    expect(nodes[3].detail).toBe('QUALITY:GLARE');
    expect(nodes[5].state).toBe('failed');
    expect(nodes[5].detail).toBe('QUALITY:GLARE');
  });

  it('pending: decode node running until the browser ZXing step settles', () => {
    const nodes = deriveLiveEvents(result(), null, 'PKG-1');
    expect(nodes[3].state).toBe('running');
    expect(nodes[3].detail).toBe('decoding…');
  });
});

describe('LiveEventStrip DOM', () => {
  it('renders six nodes with per-node detail', () => {
    render(
      <LiveEventStrip
        result={result()}
        cropDecode={{ decoded: true, payload: 'PKG-1-A', reasons: [] }}
        parcelId="PKG-1"
      />,
    );
    expect(screen.getByTestId('live-event-strip')).toBeTruthy();
    for (const name of ['capture', 'preprocessing', 'candidate', 'decode', 'association', 'final']) {
      expect(screen.getByTestId(`live-event-${name}`)).toBeTruthy();
    }
    expect(screen.getByTestId('live-event-final-detail')).toHaveTextContent('PKG-1-A');
    expect(screen.getByTestId('live-event-association-detail')).toHaveTextContent('PKG-1');
  });
});

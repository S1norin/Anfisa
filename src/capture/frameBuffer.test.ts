import { FrameBuffer, StripBufferPool, type StripPixels } from './frameBuffer';
import type { FrameObservation } from '../domain/types';
import { reportSixViewConfig } from './presets';
import { ProcessRun } from '../pipeline/runDriver';
import { buildStripTexture } from './stripPreview';
import { expectedLineCount } from './lineScanGeometry';

function makeStrip(i: number, cameraId = 'CAM-005'): StripPixels {
  const data = new Uint8ClampedArray(4 * 2 * 4);
  return {
    cameraId,
    parcelId: `P-${i}`,
    simTimeMs: i * 5,
    widthPx: 4,
    heightPx: 2,
    data,
    missingLineRows: [],
    lineCount: 2,
    expectedLineCount: 2,
    complete: true,
    encoderStartMm: i * 100,
    encoderEndMm: i * 100 + 10,
  };
}

function makeFrame(cameraId: string, simTimeMs: number): FrameObservation {
  return {
    frameId: `f-${cameraId}-${simTimeMs}`,
    runId: 'R1',
    cameraId,
    cameraState: 'CAPTURING',
    simTimeMs,
    encoderPositionMm: 0,
    cameraSnapshot: null as unknown as FrameObservation['cameraSnapshot'],
    preview: { widthPx: 960, heightPx: 540, textureRef: `rt-${cameraId}` },
    candidateParcelIds: [],
    labels: [],
    processingMode: 'GEOMETRY_MODEL',
  };
}

describe('FrameBuffer (CAM-007, NFR-005)', () => {
  it('keeps at most maxFrames metadata objects per camera', () => {
    const fb = new FrameBuffer(120);
    for (let i = 0; i < 150; i++) {
      fb.push(makeFrame('CAM-001', i * 50), null);
    }
    expect(fb.frameCount('CAM-001')).toBe(120);
    // Oldest trimmed, newest kept:
    expect(fb.latest('CAM-001')?.simTimeMs).toBe(149 * 50);
  });

  it('tracks cameras independently', () => {
    const fb = new FrameBuffer(120);
    fb.push(makeFrame('CAM-001', 0), null);
    fb.push(makeFrame('CAM-002', 0), null);
    fb.push(makeFrame('CAM-001', 50), null);
    expect(fb.frameCount('CAM-001')).toBe(2);
    expect(fb.frameCount('CAM-002')).toBe(1);
    expect(fb.latest('CAM-001')?.simTimeMs).toBe(50);
    expect(fb.cameraIds().sort()).toEqual(['CAM-001', 'CAM-002']);
  });

  it('returns undefined for unknown/empty cameras', () => {
    const fb = new FrameBuffer(120);
    expect(fb.latest('CAM-009')).toBeUndefined();
    expect(fb.textureFor('CAM-009')).toBeNull();
  });

  it('holds a texture only for the newest frame (NFR-005)', () => {
    const fb = new FrameBuffer(120);
    const t1 = { dispose: vi.fn() } as unknown as import('three').WebGLRenderTarget;
    const t2 = { dispose: vi.fn() } as unknown as import('three').WebGLRenderTarget;
    fb.push(makeFrame('CAM-001', 0), t1);
    fb.push(makeFrame('CAM-001', 50), t2);
    expect(fb.textureFor('CAM-001')).toBe(t2);
    expect(t1.dispose).not.toHaveBeenCalled(); // replaced, not disposed —
    fb.removeCamera('CAM-001'); // only the latest is the pool's to dispose
    expect(t2.dispose).toHaveBeenCalled();
    expect(t1.dispose).not.toHaveBeenCalled();
    expect(fb.latest('CAM-001')).toBeUndefined();
  });

  it('notifies subscribers on push and removal', () => {
    const fb = new FrameBuffer(120);
    const seen: string[] = [];
    fb.subscribe(() => seen.push('tick'));
    fb.push(makeFrame('CAM-001', 0), null);
    fb.removeCamera('CAM-001');
    expect(seen).toEqual(['tick', 'tick']);
  });

  it('clear() disposes live textures', () => {
    const fb = new FrameBuffer(120);
    const t = { dispose: vi.fn() } as unknown as import('three').WebGLRenderTarget;
    fb.push(makeFrame('CAM-001', 0), t);
    fb.clear();
    expect(t.dispose).toHaveBeenCalled();
    expect(fb.cameraIds()).toEqual([]);
  });
});

describe('StripBufferPool (t9, line-strip preview)', () => {
  it('caps live buffers at maxBuffers for any number of strips', () => {
    const pool = new StripBufferPool(16);
    for (let i = 0; i < 200; i++) {
      pool.push(makeStrip(i, i % 2 ? 'CAM-005' : 'CAM-006'));
      expect(pool.allocated).toBeLessThanOrEqual(16);
    }
    expect(pool.allocated).toBe(16);
    // Oldest dropped, newest kept — per camera (odd i → CAM-005).
    expect(pool.latest('CAM-005')?.parcelId).toBe('P-199');
    expect(pool.latest('CAM-006')?.parcelId).toBe('P-198');
  });

  it('a 50-parcel headless run never grows the pool past the cap', () => {
    const run = new ProcessRun(reportSixViewConfig(), 50);
    run.runToCompletion();

    const s = run.sim.state;
    const pool = new StripBufferPool(16);
    let strips = 0;
    for (const ev of s.events) {
      if (ev.type !== 'LINE_SCAN_COMPLETED' && ev.type !== 'LINE_SCAN_ABORTED') {
        continue;
      }
      const rig = s.config.cameraRigs.find((r) => r.id === ev.cameraId);
      if (!rig || rig.kind !== 'LINE_SCAN') continue;
      strips += 1;
      pool.push(
        buildStripTexture({
          rig,
          parcelId: ev.parcelId,
          simTimeMs: ev.simTimeMs,
          strip: {
            encoderStartMm: ev.encoderStartMm,
            encoderEndMm: ev.encoderEndMm,
            lineCount: ev.lineCount,
            expectedLineCount: expectedLineCount(
              ev.encoderEndMm - ev.encoderStartMm,
              rig.line.encoderStepMmPerLine,
            ),
            complete: ev.complete,
            ...(ev.type === 'LINE_SCAN_ABORTED'
              ? { abortReason: ev.reason }
              : {}),
          },
          beltSpeedMmPerSec: s.speedMmPerSec,
          seed: s.config.seed,
        }),
      );
      expect(pool.allocated).toBeLessThanOrEqual(16);
    }
    // Enough strips to overflow a 16-buffer cap many times over.
    expect(strips).toBeGreaterThan(16);
    expect(pool.allocated).toBe(16);
  });

  it('clear() drops all live strips', () => {
    const pool = new StripBufferPool(16);
    pool.push(makeStrip(0));
    pool.push(makeStrip(1));
    pool.clear();
    expect(pool.allocated).toBe(0);
    expect(pool.latest('CAM-005')).toBeUndefined();
  });
});

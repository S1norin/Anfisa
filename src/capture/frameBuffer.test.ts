import { FrameBuffer } from './frameBuffer';
import type { FrameObservation } from '../domain/types';

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

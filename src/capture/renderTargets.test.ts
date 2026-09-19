import { RenderTargetPool } from './renderTargets';
import * as THREE from 'three';

/** Count 'dispose' events on the target (rt.dispose() dispatches on itself). */
function disposeCounter(rt: THREE.WebGLRenderTarget): () => number {
  let n = 0;
  rt.addEventListener('dispose', () => {
    n += 1;
  });
  return () => n;
}

describe('RenderTargetPool (CAM-006, NFR-003)', () => {
  it('creates one bounded preview-size target per camera key', () => {
    const pool = new RenderTargetPool();
    const a = pool.acquire('CAM-001', 960, 540);
    const b = pool.acquire('CAM-002', 960, 540);
    expect(a).not.toBe(b);
    expect(a.width).toBe(960);
    expect(a.height).toBe(540);
    expect(a.depthBuffer).toBe(true);
    expect(pool.size()).toBe(2);
    pool.dispose();
  });

  it('reuses the same target for the same key and size', () => {
    const pool = new RenderTargetPool();
    const a = pool.acquire('CAM-001', 960, 540);
    const b = pool.acquire('CAM-001', 960, 540);
    expect(b).toBe(a);
    expect(pool.size()).toBe(1);
    pool.dispose();
  });

  it('replaces the target when the preview size changes, disposing the old', () => {
    const pool = new RenderTargetPool();
    const a = pool.acquire('CAM-001', 960, 540);
    const countA = disposeCounter(a);
    const b = pool.acquire('CAM-001', 640, 360);
    expect(b).not.toBe(a);
    expect(b.width).toBe(640);
    expect(countA()).toBe(1); // old target disposed
    expect(pool.size()).toBe(1);
    pool.dispose();
  });

  it('releases a camera target for reuse by another camera', () => {
    const pool = new RenderTargetPool();
    const a = pool.acquire('CAM-001', 960, 540);
    const countA = disposeCounter(a);
    pool.release('CAM-001');
    expect(pool.has('CAM-001')).toBe(false);
    expect(countA()).toBe(1);
    expect(pool.size()).toBe(0);
    const b = pool.acquire('CAM-002', 960, 540);
    expect(b).toBeDefined();
    pool.dispose();
  });

  it('dispose() drops every target', () => {
    const pool = new RenderTargetPool();
    const a = pool.acquire('CAM-001', 960, 540);
    pool.acquire('CAM-002', 960, 540);
    const countA = disposeCounter(a);
    pool.dispose();
    expect(countA()).toBe(1);
    expect(pool.size()).toBe(0);
    expect(pool.keys()).toEqual([]);
  });
});

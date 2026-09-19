import * as THREE from 'three';

/**
 * Ping-pong pool of preview-size render target PAIRS (IMG-005..012 visual
 * side). The capture pipeline renders the clean scene into one target and
 * the artifact pass into the other, alternating per frame so a target is
 * never read and written in the same pass.
 *
 * Same bounds as the plain pool: ONE pair per camera, PREVIEW resolution,
 * reused across frames, disposed on release / disposal (NFR-003).
 */
export class PingPongPool {
  private byKey = new Map<
    string,
    {
      widthPx: number;
      heightPx: number;
      a: THREE.WebGLRenderTarget;
      b: THREE.WebGLRenderTarget;
      flip: boolean;
    }
  >();

  private makeRt(w: number, h: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
  }

  /**
   * Get (or create / resize) the pair for a camera and flip it.
   * Returns `{ src, dst }`: render the clean scene into `src`, the artifact
   * pass into `dst` (which is the frame's texture).
   */
  acquire(
    key: string,
    widthPx: number,
    heightPx: number,
  ): { src: THREE.WebGLRenderTarget; dst: THREE.WebGLRenderTarget } {
    const existing = this.byKey.get(key);
    if (
      existing &&
      existing.widthPx === widthPx &&
      existing.heightPx === heightPx
    ) {
      existing.flip = !existing.flip;
      return existing.flip
        ? { src: existing.a, dst: existing.b }
        : { src: existing.b, dst: existing.a };
    }
    if (existing) {
      existing.a.dispose();
      existing.b.dispose();
      this.byKey.delete(key);
    }
    const a = this.makeRt(widthPx, heightPx);
    const b = this.makeRt(widthPx, heightPx);
    this.byKey.set(key, { widthPx, heightPx, a, b, flip: false });
    return { src: a, dst: b };
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  release(key: string): void {
    const e = this.byKey.get(key);
    if (!e) return;
    e.a.dispose();
    e.b.dispose();
    this.byKey.delete(key);
  }

  keys(): string[] {
    return [...this.byKey.keys()];
  }

  size(): number {
    return this.byKey.size;
  }

  dispose(): void {
    for (const e of this.byKey.values()) {
      e.a.dispose();
      e.b.dispose();
    }
    this.byKey.clear();
  }
}

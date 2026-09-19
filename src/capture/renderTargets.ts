import * as THREE from 'three';

/**
 * Bounded pool of preview-size render targets (CAM-006, NFR-003).
 *
 * Keys are camera ids: at most ONE live target per camera, at PREVIEW
 * resolution (never the physical sensor grid — that is metadata only,
 * REV-12). Targets are reused across frames, resized when a preview size
 * changes, and disposed on release and on pool disposal.
 */
export class RenderTargetPool {
  private byKey = new Map<
    string,
    { widthPx: number; heightPx: number; rt: THREE.WebGLRenderTarget }
  >();

  /** Get (or create / resize) the target for a camera. */
  acquire(
    key: string,
    widthPx: number,
    heightPx: number,
  ): THREE.WebGLRenderTarget {
    const existing = this.byKey.get(key);
    if (
      existing &&
      existing.widthPx === widthPx &&
      existing.heightPx === heightPx
    ) {
      return existing.rt;
    }
    if (existing) {
      existing.rt.dispose();
      this.byKey.delete(key);
    }
    const rt = new THREE.WebGLRenderTarget(widthPx, heightPx, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.byKey.set(key, { widthPx, heightPx, rt });
    return rt;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** Drop a camera's target (camera removed) and dispose it. */
  release(key: string): void {
    const entry = this.byKey.get(key);
    if (!entry) return;
    entry.rt.dispose();
    this.byKey.delete(key);
  }

  keys(): string[] {
    return [...this.byKey.keys()];
  }

  size(): number {
    return this.byKey.size;
  }

  /** Dispose every target (unmount / run reset). */
  dispose(): void {
    for (const entry of this.byKey.values()) entry.rt.dispose();
    this.byKey.clear();
  }
}

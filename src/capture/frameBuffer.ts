import type { FrameObservation } from '../domain/types';
import type * as THREE from 'three';

/**
 * Bounded per-camera frame buffer (CAM-007, NFR-005).
 *
 * Keeps the last `maxFrames` (default 120 — config
 * `frameBufferMaxPerCamera`) FrameObservation metadata objects per camera.
 * GPU textures are held ONLY for the latest frame (a camera's render target
 * is the texture for its newest frame until the next capture replaces it);
 * older metadata is cheap CPU data.
 */
export interface FrameBufferEntry {
  cameraId: string;
  /** Oldest → newest; length <= maxFrames. */
  frames: FrameObservation[];
  /** Render target backing the newest frame (null once the camera is gone). */
  latestTexture: THREE.WebGLRenderTarget | null;
}

type Listener = () => void;

export class FrameBuffer {
  private readonly maxFrames: number;
  private byCamera = new Map<string, FrameBufferEntry>();
  private listeners = new Set<Listener>();

  constructor(maxFrames = 120) {
    this.maxFrames = maxFrames;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** Append a frame, trimming oldest metadata beyond the bound. */
  push(frame: FrameObservation, texture: THREE.WebGLRenderTarget | null): void {
    let entry = this.byCamera.get(frame.cameraId);
    if (!entry) {
      entry = { cameraId: frame.cameraId, frames: [], latestTexture: null };
      this.byCamera.set(frame.cameraId, entry);
    }
    entry.frames.push(frame);
    const overflow = entry.frames.length - this.maxFrames;
    if (overflow > 0) entry.frames.splice(0, overflow);
    entry.latestTexture = texture;
    this.notify();
  }

  latest(cameraId: string): FrameObservation | undefined {
    const entry = this.byCamera.get(cameraId);
    if (!entry || entry.frames.length === 0) return undefined;
    return entry.frames[entry.frames.length - 1];
  }

  textureFor(cameraId: string): THREE.WebGLRenderTarget | null {
    return this.byCamera.get(cameraId)?.latestTexture ?? null;
  }

  frameCount(cameraId: string): number {
    return this.byCamera.get(cameraId)?.frames.length ?? 0;
  }

  cameraIds(): string[] {
    return [...this.byCamera.keys()];
  }

  /** Drop a removed camera's metadata and dispose its texture (NFR-003). */
  removeCamera(cameraId: string): void {
    const entry = this.byCamera.get(cameraId);
    if (!entry) return;
    if (entry.latestTexture) entry.latestTexture.dispose();
    this.byCamera.delete(cameraId);
    this.notify();
  }

  /** Drop everything (run reset / unmount); disposes textures. */
  clear(): void {
    for (const id of this.cameraIds()) this.removeCamera(id);
  }
}

/** App-wide singleton — the scene layer pushes, the feed wall reads. */
export const frameBuffer = new FrameBuffer(120);

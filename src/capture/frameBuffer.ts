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

// ---------------------------------------------------------------------------
// Bounded strip buffer pool (t9, line-scan preview — display-only, NFR-002)
// ---------------------------------------------------------------------------

/**
 * One strip reconstruction pushed to the pool. A StripTexture (t9)
 * satisfies this structurally; the pool is the display-side owner of the
 * pixel data. Decode NEVER reads these pixels (NFR-002).
 */
export interface StripPixels {
  cameraId: string;
  parcelId: string;
  simTimeMs: number;
  /** Display columns per line (downsampled from pixelsPerLine). */
  widthPx: number;
  /** Rows: one per encoder line across the strip (encoder-mapped). */
  heightPx: number;
  /** RGBA, row 0 = encoder start; rows advance along the encoder axis. */
  data: Uint8ClampedArray;
  /** Encoder-mapped row indices of dropped lines (black in `data`). */
  missingLineRows: number[];
  lineCount: number;
  expectedLineCount: number;
  complete: boolean;
  encoderStartMm: number;
  encoderEndMm: number;
}

/** A live buffer in the pool (the pushed StripPixels object itself). */
export type StripBufferEntry = StripPixels;

/**
 * Bounded ring of the last `maxBuffers` line-strip reconstructions.
 *
 * Each closed strip pushes one entry; at the cap the OLDEST entry is
 * dropped, so `allocated` stays <= `maxBuffers` for any number of strips
 * (t9 AC: a 50-parcel headless run never grows the pool past the cap).
 * Per-camera reads go through `latest(cameraId)` — the newest strip for
 * that rig, which is what the camera wall renders.
 */
export class StripBufferPool {
  readonly maxBuffers: number;
  /** Oldest → newest live strips. */
  private readonly entries: StripBufferEntry[] = [];

  constructor(maxBuffers = 16) {
    this.maxBuffers = Math.max(1, Math.floor(maxBuffers));
  }

  /** Live buffer count — invariant: always <= maxBuffers. */
  get allocated(): number {
    return this.entries.length;
  }

  /** Push a strip; drops the oldest entry once the cap is reached. */
  push(strip: StripPixels): StripBufferEntry {
    if (this.entries.length >= this.maxBuffers) this.entries.shift();
    this.entries.push(strip);
    return strip;
  }

  /** Newest live strip for `cameraId` (undefined if the rig has none). */
  latest(cameraId: string): StripBufferEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].cameraId === cameraId) return this.entries[i];
    }
    return undefined;
  }

  /** Drop everything (run reset / unmount). */
  clear(): void {
    this.entries.length = 0;
  }
}

/** App-wide singleton for line-strip previews (wall reads, store pushes). */
export const stripBufferPool = new StripBufferPool(16);

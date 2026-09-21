/**
 * Live-processing browser client (t7-1, sub-task s2).
 *
 * Receives immutable capture records for the selected camera and enforces:
 *
 *  - at most ONE in-flight processing request per camera;
 *  - only the NEWEST frame / completed strip of a camera is ever sent —
 *    a queued capture is replaced by a newer one before it is sent;
 *  - stale results (older captures arriving late) are dropped; the
 *    applied preview is always the newest result for that camera.
 *
 * The client renders nothing — the UI consumes LiveProcessingResult and
 * runs no image filters.
 */

import type {
  LiveCaptureInput,
  LiveProcessingResult,
  LiveProcessingService,
} from './contracts';
import { isLiveProcessingResult } from './contracts';

interface CameraQueue {
  /** Newest capture not yet sent (replaces older queued ones). */
  pending: LiveCaptureInput | null;
  inFlight: boolean;
  /** Monotonic seq of the newest APPLIED result (stale detection). */
  appliedSeq: number;
}

export interface LiveProcessingClientOptions {
  /**
   * Called for results the UI may display (newest-wins per camera).
   * Malformed service responses are rejected here, not in components.
   */
  onResult?: (result: LiveProcessingResult) => void;
  /** Called when a request fails (e.g. service unavailable). */
  onError?: (cameraId: string, error: unknown) => void;
}

export class LiveProcessingClient {
  private service: LiveProcessingService;
  private queues = new Map<string, CameraQueue>();
  private seq = 0;
  private resultCb?: (result: LiveProcessingResult) => void;
  private errorCb?: (cameraId: string, error: unknown) => void;

  constructor(service: LiveProcessingService, options: LiveProcessingClientOptions = {}) {
    this.service = service;
    this.resultCb = options.onResult;
    this.errorCb = options.onError;
  }

  /**
   * Submit a capture. The client assigns its sequence number. If a
   * request for this camera is already in flight, the capture is queued
   * (replacing any older queued one) and sent when the flight settles.
   */
  submit(capture: LiveCaptureInput): void {
    const q = this.queueFor(capture.cameraId);
    const input = { ...capture, seq: ++this.seq };
    q.pending = input;
    if (!q.inFlight) void this.drain(capture.cameraId);
  }

  /** Latest applied result for a camera (the current preview). */
  lastResult(cameraId: string): LiveProcessingResult | undefined {
    let best: LiveProcessingResult | undefined;
    this.applied.forEach((r) => {
      if (r.cameraId === cameraId && (!best || r.seq > best.seq)) best = r;
    });
    return best;
  }

  /** Whether a request is currently in flight for a camera. */
  isProcessing(cameraId: string): boolean {
    return this.queues.get(cameraId)?.inFlight ?? false;
  }

  /** Newer results replace the preview; a result is dropped when a
   *  newer one was already applied (stale preview replacement). */
  onResult(cb: (result: LiveProcessingResult) => void): () => void {
    const prev = this.resultCb;
    this.resultCb = (r) => {
      prev?.(r);
      cb(r);
    };
    return () => {
      this.resultCb = prev;
    };
  }

  onError(cb: (cameraId: string, error: unknown) => void): () => void {
    const prev = this.errorCb;
    this.errorCb = (cam, e) => {
      prev?.(cam, e);
      cb(cam, e);
    };
    return () => {
      this.errorCb = prev;
    };
  }

  private applied: LiveProcessingResult[] = [];

  private queueFor(cameraId: string): CameraQueue {
    let q = this.queues.get(cameraId);
    if (!q) {
      q = { pending: null, inFlight: false, appliedSeq: 0 };
      this.queues.set(cameraId, q);
    }
    return q;
  }

  private async drain(cameraId: string): Promise<void> {
    const q = this.queues.get(cameraId);
    const capture = q?.pending;
    if (!q || !capture) return;
    q.inFlight = true;
    q.pending = null;
    try {
      const result = await this.service.process(capture);
      this.settle(cameraId, result);
    } catch (error) {
      this.settle(cameraId, undefined, error);
    }
  }

  private settle(
    cameraId: string,
    result: LiveProcessingResult | undefined,
    error?: unknown,
  ): void {
    const q = this.queues.get(cameraId);
    if (!q) return;
    q.inFlight = false;
    if (result !== undefined) {
      if (isLiveProcessingResult(result)) {
        // Stale: a newer result for this camera was already applied.
        const stale = result.seq < q.appliedSeq;
        if (!stale) {
          q.appliedSeq = result.seq;
          this.applied.push(result);
          if (this.applied.length > 256) this.applied.splice(0, this.applied.length - 256);
          this.resultCb?.(result);
        }
      }
    } else if (error !== undefined) {
      this.errorCb?.(cameraId, error);
    }
    // A newer capture may have arrived during the flight — send it now.
    if (q.pending !== null) void this.drain(cameraId);
  }
}

/**
 * HTTP implementation of the LiveProcessingService boundary (t7-3).
 *
 * POSTs the EXACT capture the client was given to the Python/OpenCV
 * service (t7-2, services/live_processing/app.py) and maps the JSON
 * response onto the LiveProcessingResult contract (stage bytes are
 * base64 on the wire). Any transport failure rejects — the UI shows
 * 'Live Processing unavailable' and Guided Replay stays usable.
 */

import type {
  LiveCaptureInput,
  LiveProcessingResult,
  LiveProcessingService,
  LiveSourceKind,
  LiveStageImage,
} from './contracts';

export interface HttpLiveServiceOptions {
  /** Service base URL. Default: the t7-2 dev service on port 8790. */
  baseUrl?: string;
  /** Injected fetch (tests). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8790';

/**
 * The service throttled this camera (HTTP 429) — expected flow control,
 * NOT a service outage. The UI must keep its current state and let the
 * next scheduled emit retry; it must not flip to 'unavailable'.
 */
export class LiveThrottleError extends Error {
  readonly throttled = true;
  constructor() {
    super('live processing service throttled (HTTP 429)');
    this.name = 'LiveThrottleError';
  }
}

/** True when a service failure is a per-camera throttle (429). */
export function isLiveThrottled(error: unknown): boolean {
  return (
    error instanceof LiveThrottleError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { throttled?: unknown }).throttled === true)
  );
}

/** Bytes -> base64 (chunked to avoid call-stack limits on large frames). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 -> bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Map the service JSON (wire form) onto the contract. Stage bytes are
 * decoded from base64; a `null` candidate becomes `undefined`; the
 * optional `pending` decode flag passes through.
 */
export function mapResult(json: Record<string, unknown>): LiveProcessingResult {
  const stages = (json.stages as Record<string, unknown>[]) ?? [];
  const candidate = json.candidate as
    | { quadPx: number[][]; source?: string }
    | null
    | undefined;
  const decode = (json.decode ?? {}) as Record<string, unknown>;
  return {
    captureId: json.captureId as string,
    seq: json.seq as number,
    ...(typeof json.parcelId === 'string' ? { parcelId: json.parcelId } : {}),
    cameraId: json.cameraId as string,
    sourceType: json.sourceType as LiveSourceKind,
    simTimeMs: json.simTimeMs as number,
    encoderSpanMm: json.encoderSpanMm as [number, number],
    stages: stages.map((s) => {
      const stage: LiveStageImage = {
        name: s.name as string,
        data: base64ToBytes(s.dataB64 as string),
        mime: (s.mime as LiveStageImage['mime']) ?? 'image/png',
        width: s.width as number,
        height: s.height as number,
      };
      return stage;
    }),
    ...(candidate
      ? { candidate: { quadPx: candidate.quadPx as [number, number][], source: 'pixels' as const } }
      : {}),
    decode: {
      decoded: Boolean(decode.decoded),
      ...(typeof decode.decodedPayload === 'string'
        ? { decodedPayload: decode.decodedPayload }
        : {}),
      ...(typeof decode.pending === 'boolean' ? { pending: decode.pending } : {}),
      reasons: (decode.reasons as string[]) ?? [],
      confidence: (decode.confidence as number) ?? 0,
    },
    processingMs: json.processingMs as number,
  };
}

/** Create the fetch-based service (the real browser implementation). */
export function createHttpLiveProcessingService(
  opts: HttpLiveServiceOptions = {},
): LiveProcessingService {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const f = opts.fetchImpl ?? fetch;
  return {
    async process(capture: LiveCaptureInput, signal?: AbortSignal) {
      const body = {
        captureId: capture.captureId,
        cameraId: capture.cameraId,
        sourceType: capture.sourceType,
        simTimeMs: capture.simTimeMs,
        encoderSpanMm: capture.encoderSpanMm,
        seq: capture.seq ?? 0,
        imageB64: bytesToBase64(capture.image.data),
        imageMime: capture.image.mime,
      };
      const resp = await f(`${base}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!resp.ok) {
        if (resp.status === 429) throw new LiveThrottleError();
        throw new Error(`live processing service HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as Record<string, unknown>;
      return mapResult(json);
    },
  };
}

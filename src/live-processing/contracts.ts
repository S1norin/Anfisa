/**
 * Live-processing typed contract (t7-1, sub-task s1).
 *
 * One result contract for BOTH sensor types (area camera frames and
 * completed line strips): capture ID, parcel ID if known, camera ID,
 * source type, time/encoder span, NAMED stage images, candidate
 * coordinates, decoded payload or explicit reasons, and processing
 * duration.
 *
 * The UI renders only this contract — no image filters run inside React
 * components. The service returns stages computed from the EXACT input
 * capture it received; it must never substitute a precomputed
 * guided-replay image for a live capture.
 *
 * This module is display-path only: no pipeline logic, no camera access.
 */

/** The two live source kinds the contract covers. */
export type LiveSourceKind = 'AREA_FRAME' | 'LINE_STRIP';

/** Image bytes of one stage preview (the service computed them). */
export interface LiveStageImage {
  /**
   * Stable stage name — the service defines the set (e.g. 'original',
   * 'downscaled', 'enhanced', 'decode-crop'); the UI renders by name.
   */
  name: string;
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

/** Candidate coordinates: 4 corners in source-image pixel space. */
export interface LiveCandidate {
  /** Present when the service resolved the instance upstream. */
  labelInstanceId?: string;
  /**
   * Corner order (−u,−v), (+u,−v), (+u,+v), (−u,+v) — same convention as
   * the replay manifest's CandidateInfo.
   */
  quadPx: [number, number][];
  source: 'pixels';
}

/** Decode outcome for the exact input capture. */
export interface LiveDecode {
  decoded: boolean;
  /** Only when decoded === true. */
  decodedPayload?: string;
  /** Reason codes when decoded === false (e.g. 'QUALITY:GLARE'). */
  reasons: string[];
  /** 0 when not decoded. */
  confidence: number;
}

/**
 * Immutable capture record handed from the camera pipeline to the client.
 * The browser sends only the SELECTED camera's newest frame / completed
 * strip — the client enforces at most one in-flight request per camera.
 */
export interface LiveCaptureInput {
  captureId: string;
  cameraId: string;
  sourceType: LiveSourceKind;
  simTimeMs: number;
  encoderSpanMm: [number, number];
  /** Raw sensor image of the exact capture (no post-processing). */
  image: {
    data: Uint8Array;
    width: number;
    height: number;
    mime: 'image/png' | 'image/jpeg';
  };
  /**
   * Monotonic per-client sequence assigned at submit; the client uses it
   * to drop stale results (a newer capture has already been shown).
   */
  seq?: number;
}

/**
 * The ONE result contract: everything the live UI needs to render the
 * selected sensor's processing preview and its outcome.
 */
export interface LiveProcessingResult {
  /** The exact capture this result was computed from. */
  captureId: string;
  /** Client sequence of the input (stale-result detection). */
  seq: number;
  /** Known when association resolved it; undefined otherwise. */
  parcelId?: string;
  cameraId: string;
  sourceType: LiveSourceKind;
  simTimeMs: number;
  encoderSpanMm: [number, number];
  /** Named stage images, service order. */
  stages: LiveStageImage[];
  /** Present when a candidate was found in the pixels. */
  candidate?: LiveCandidate;
  decode: LiveDecode;
  /** Wall-clock processing duration on the service (ms). */
  processingMs: number;
}

/**
 * The service boundary the browser client talks to. The real
 * implementation POSTs the capture to the Python/OpenCV service; tests
 * use a fake.
 */
export interface LiveProcessingService {
  process(
    capture: LiveCaptureInput,
    signal?: AbortSignal,
  ): Promise<LiveProcessingResult>;
}

/**
 * Runtime guard for AC1: a result must carry every contract field. Used
 * by the client to reject malformed service responses before they reach
 * the UI (the service is a separate process — the contract is its API).
 */
export function isLiveProcessingResult(value: unknown): value is LiveProcessingResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const span = (s: unknown): s is [number, number] =>
    Array.isArray(s) && s.length === 2 && s.every((n) => typeof n === 'number');
  return (
    typeof r.captureId === 'string' &&
    typeof r.seq === 'number' &&
    (r.parcelId === undefined || typeof r.parcelId === 'string') &&
    typeof r.cameraId === 'string' &&
    (r.sourceType === 'AREA_FRAME' || r.sourceType === 'LINE_STRIP') &&
    typeof r.simTimeMs === 'number' &&
    span(r.encoderSpanMm) &&
    Array.isArray(r.stages) &&
    r.stages.every(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as LiveStageImage).name === 'string' &&
        (s as LiveStageImage).data instanceof Uint8Array &&
        typeof (s as LiveStageImage).width === 'number' &&
        typeof (s as LiveStageImage).height === 'number',
    ) &&
    (r.candidate === undefined ||
      (typeof r.candidate === 'object' &&
        r.candidate !== null &&
        Array.isArray((r.candidate as LiveCandidate).quadPx))) &&
    typeof r.decode === 'object' &&
    r.decode !== null &&
    typeof (r.decode as LiveDecode).decoded === 'boolean' &&
    Array.isArray((r.decode as LiveDecode).reasons) &&
    typeof r.processingMs === 'number'
  );
}

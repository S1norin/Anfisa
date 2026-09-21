/**
 * Guided-replay manifest format (HOW_IT_WORKS_VISUAL_REDESIGN_PLAN.md,
 * implementation order #1: "lock the story data").
 *
 * One manifest tells the complete story of ONE parcel through the station:
 * its pose/encoder keyframes, every sensor capture with its stage images,
 * candidates (with an explicit source label — pixels vs geometry vs manual),
 * the pixel-decoded observations, and the final result. The browser animates
 * the SAVED stage images (generated offline by scripts/gen_hiw_assets.py);
 * it never recomputes them.
 *
 * Truthfulness rules baked into the format:
 *  - `candidate.source` — an overlay drawn from a non-pixel source MUST be
 *    labeled "illustrative candidate location" by the UI.
 *  - `expectedDecode` is the ground truth of the asset run; the UI re-decodes
 *    `decodeCropPath` in the browser (ZXing) and displays THAT value.
 *  - Failed reads carry explicit reasons and never a payload.
 *
 * The format is plain JSON (serializable by the Python generator, loadable
 * by the browser). No Dates, no functions, no buffers.
 */

import type { Face } from '../../domain/types';

export const REPLAY_SCHEMA_VERSION = 1 as const;

/** How a candidate region was obtained (drives the UI's honesty label). */
export type CandidateSource = 'pixels' | 'geometry' | 'manual';

export type SensorKind = 'LINE_SCAN' | 'AREA_CAMERA';

export interface SensorRef {
  /** e.g. 'ls-top', 'ls-bottom', 'cam-side-1'..'cam-side-6'. */
  id: string;
  kind: SensorKind;
  /** Parcel face this sensor observes. */
  face: Face;
}

/**
 * Image processing stages, in display order. Line scans and area frames
 * share the same stage vocabulary (maskedCrop = static mask/parcel crop for
 * strips, mask + ROI for area frames; rectifiedCrop = rectified barcode crop
 * for strips, perspective-corrected crop for area frames).
 */
export type StageName =
  | 'raw'
  | 'maskedCrop'
  | 'grayscaleContrast'
  | 'edgeMap'
  | 'candidateOverlay'
  | 'rectifiedCrop';

export interface StageImage {
  stage: StageName;
  /** Path relative to the app base URL, e.g. 'hiw/assets/success/cap-1/raw.png'. */
  path: string;
}

export interface CandidateInfo {
  labelInstanceId: string;
  /** 'pixels' only if the candidate actually comes from the capture's pixels. */
  source: CandidateSource;
  /**
   * 4 candidate corners in raw-image pixels, same order as
   * `PixelLabelCandidate.quadPx`: (−u,−v), (+u,−v), (+u,+v), (−u,+v).
   */
  quadPx: [number, number][];
}

export interface CaptureRecord {
  /**
   * Processing parameters recorded by the asset generator (thresholds, blur
   * settings, warp scale). Optional: the UI ignores unknown keys.
   */
  params?: Record<string, unknown>;
  captureId: string;
  sensorId: string;
  kind: SensorKind;
  parcelId: string;
  /** Story time of the capture (ms within the replay). */
  simTimeMs: number;
  /**
   * Encoder span for LINE_STRIP captures (start/end of the strip); a single
   * reading [v, v] for AREA_FRAME captures.
   */
  encoderSpanMm: [number, number];
  /** Stage images in display order; stages[0] is always 'raw'. */
  stages: StageImage[];
  /** Present when the preprocessing step found (or was given) a candidate. */
  candidate?: CandidateInfo;
  /**
   * Decoder-input crop (rectified / perspective-corrected). The browser
   * decodes THIS file; `expectedDecode` is the ground truth of the asset run.
   */
  decodeCropPath?: string;
  expectedDecode?: {
    decoded: boolean;
    /** Only when decoded === true. */
    payload?: string;
    /** Reason codes when decoded === false (e.g. 'QUALITY:GLARE'). */
    reasons: string[];
  };
}

/** The six stages in display order (shared by line scans and area frames). */
export const STAGE_ORDER: StageName[] = [
  'raw',
  'maskedCrop',
  'grayscaleContrast',
  'edgeMap',
  'candidateOverlay',
  'rectifiedCrop',
];

export interface PoseKeyframe {
  /** Story time (ms). */
  tMs: number;
  /** Parcel front position on the belt (mm). */
  frontZMm: number;
  /** Encoder reading (mm) — 1:1 with belt travel. */
  encoderMm: number;
}

export interface ReplayStep {
  /** Storyboard step number, 1..8. */
  step: number;
  tStartMs: number;
  tEndMs: number;
  /** Sensors highlighted in the 3D view during this step. */
  sensorIds: string[];
  /** Capture shown in the right panel during this step (undefined for step 1). */
  captureId?: string;
}

export interface ReplayObservation {
  observationId: string;
  captureId: string;
  parcelId: string;
  labelInstanceId: string;
  decoded: boolean;
  /** Only when decoded === true — the pixel-decoded value. */
  decodedPayload?: string;
  /** Reason codes when decoded === false. */
  reasons: string[];
  /** Association verdict for the parcel's time/position window. */
  association: { ok: boolean; mismatch?: string };
}

export interface ResultValue {
  labelInstanceId: string;
  face: Face;
  payload: string;
  /** Captures that produced this value (source sensors). */
  sourceCaptureIds: string[];
  /** Total accepted reads of this physical label, collapsed into one entry. */
  mergedReads: number;
}

export interface FailedRead {
  captureId: string;
  labelInstanceId: string;
  reasons: string[];
}

export type ReplayResultStatus =
  | 'OK'
  | 'PARTIAL'
  | 'NO_READ'
  | 'AMBIGUOUS'
  | 'SENSOR_FAULT';

export interface ReplayResult {
  parcelId: string;
  status: ReplayResultStatus;
  /** Story time of finalization (ms). */
  finalSimTimeMs: number;
  /** Unique values, one entry per physical label instance. */
  values: ResultValue[];
  /** Failed reads with explicit reasons (never a fabricated value). */
  failedReads: FailedRead[];
}

export interface ReplayManifest {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  /** 'success' | 'no-read' — the two curated fixtures. */
  fixtureId: string;
  parcel: {
    parcelId: string;
    /** Human-readable story label, e.g. "Sample parcel (clean reads)". */
    label: string;
    /** Ground-truth label instances carried by the parcel. */
    labels: { labelInstanceId: string; face: Face; payload: string }[];
  };
  /** Total replay duration (ms). */
  durationMs: number;
  /** Parcel pose along the story (monotonic in tMs). */
  keyframes: PoseKeyframe[];
  sensors: SensorRef[];
  captures: CaptureRecord[];
  observations: ReplayObservation[];
  /** Storyboard timing for the 8 steps. */
  steps: ReplayStep[];
  result: ReplayResult;
}

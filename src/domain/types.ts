/**
 * Domain types (SIM-001, §7 contracts).
 * Ground truth exists in the run audit record but must not be read by the
 * simulated decoder when deciding success (§7 note).
 */

export type CameraState =
  | 'OFFLINE'
  | 'IDLE'
  | 'ARMED'
  | 'CAPTURING'
  | 'PROCESSING'
  | 'FAULT';

export type CameraRole =
  | 'FRONT'
  | 'REAR'
  | 'LEFT'
  | 'RIGHT'
  | 'TOP'
  | 'BOTTOM'
  | 'CUSTOM';

export type Face = 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';

export type MaterialPreset =
  | 'KRAFT'
  | 'WHITE_CARD'
  | 'DARK_CARD'
  | 'GLOSSY_TAPE'
  | 'MATTE_WRAP'
  | 'CUSTOM';

export type ParcelResultStatus =
  | 'OK'
  | 'NO_READ'
  | 'PARTIAL'
  | 'SENSOR_FAULT'
  | 'AMBIGUOUS';

export type ProcessingMode = 'GEOMETRY_MODEL' | 'PIXEL_DECODER';

/** Why an association failed (PIPE-008). */
export type AssociationMismatch =
  | 'PARCEL_UNKNOWN'
  | 'GHOST_INSTANCE'
  | 'POSITION_OUT_OF_WINDOW'
  | 'TIME_OUT_OF_WINDOW';

/** Per physical-label-instance result (audit-facing: ground truth allowed). */
export interface LabelResult {
  labelInstanceId: string;
  face: Face;
  /** Ground-truth payload of the instance. */
  payload: string;
  /** Value returned by the last validated decode (undefined if never decoded). */
  decodedPayload?: string;
  decoded: boolean;
  bestConfidence: number;
  /** All observations of this instance across frames/cameras (MET-005). */
  observationCount: number;
  decodedCount: number;
  cameras: string[];
  /** Union of reason codes seen on the best observations. */
  reasons: string[];
}

/** Final per-parcel result after finalize (PIPE-009). */
export interface ParcelResult {
  parcelId: string;
  status: ParcelResultStatus;
  expectedLabels: number;
  decodedLabels: number;
  uniquePayloads: number;
  /** Decoded payload values, duplicates preserved (legitimate repeats). */
  payloads: string[];
  labelResults: LabelResult[];
  entrySimTimeMs: number;
  exitSimTimeMs: number;
  finalizedSimTimeMs: number;
  /** Set when the simulated PLC ACK arrives (PIPE-006 tail). */
  ackSimTimeMs?: number;
  entryToResultMs: number;
  exitToResultMs: number;
}

/**
 * Area-scan reader (the v2 rig type): one 2-D sensor capturing frames at
 * a fixed fps. Kind discriminator added in config v3.
 */
export interface AreaScanCameraConfig {
  kind: 'AREA_SCAN';
  id: string;
  name: string;
  role: CameraRole;
  pose: {
    positionMm: [number, number, number];
    quaternion: [number, number, number, number]; // x, y, z, w
  };
  sensor: {
    widthPx: number;
    heightPx: number;
    focalLengthMm: number;
    filmGaugeMm: number;
    nearMm: number;
    farMm: number;
    roi?: { x: number; y: number; width: number; height: number };
  };
  acquisition: {
    fps: number;
    exposureUs: number;
    gainDb: number;
    shutter: 'GLOBAL' | 'ROLLING';
    focusDistanceMm: number;
    rollingReadoutUs: number;
  };
  illumination: {
    intensity: number;
    polarized: boolean;
    strobeUs: number;
    ambientLeak: number;
    flickerHz?: 50 | 60;
  };
  optics: {
    apertureProxy: number;
    radialDistortion: [number, number];
    vignetting: number;
  };
  imageEffects: {
    motionBlur: 'OFF' | 'DIRECTIONAL' | 'TEMPORAL_ACCUMULATION';
    temporalSamples: number;
    shotNoise: number;
    readNoise: number;
    compression: number;
    /** Presentation only; excluded from metrics (IMG-003). */
    artifactAmplification: number;
    /**
     * Independent effect switches (IMG-012) for clean/physical/amplified
     * comparison. They gate the VISIBLE degradation only; the analytic
     * values the quality model reads are always computed.
     */
    toggles: {
      motionBlur: boolean;
      focus: boolean;
      noise: boolean;
      exposure: boolean;
      glare: boolean;
      compression: boolean;
      lens: boolean;
    };
  };
  preview: { widthPx: number; heightPx: number; overlay: boolean };
  enabled: boolean;
}

/**
 * Encoder-synced line-scan rig (config v3, LINE_SCAN): a line sensor
 * across the belt imaging one row per encoder step. A parcel's full strip
 * is assembled while it crosses `line.scanPlaneZMm`; the sim emits the
 * bounded LINE_SCAN_* event set (started/completed/aborted), never
 * per-line data.
 */
export interface LineScanCameraConfig {
  kind: 'LINE_SCAN';
  id: string;
  name: string;
  role: CameraRole;
  pose: {
    positionMm: [number, number, number];
    quaternion: [number, number, number, number]; // x, y, z, w
  };
  line: {
    /** Pixels across the belt per acquired line. */
    pixelsPerLine: number;
    /** Physical line-sensor width across the belt, mm. */
    sensorWidthMm: number;
    /** Encoder travel per acquired line, mm. */
    encoderStepMmPerLine: number;
    /** Hardware ceiling: maximum lines per second. */
    maxLineRateLinesPerSec: number;
    /** Maximum strip length per parcel, mm (safety bound). */
    maxStripLengthMm: number;
    /** Z (mm) of the belt-normal plane where the line image is formed. */
    scanPlaneZMm: number;
    /** Per-line exposure, µs. */
    lineExposureUs: number;
  };
  illumination: {
    intensity: number;
    polarized: boolean;
    ambientLeak: number;
  };
  /** Strip-reconstruction degradations, each 0..1. */
  imageEffects: {
    /** Encoder-to-line mapping jitter. */
    jitter: number;
    /** Per-line probability of a dropped line. */
    missingLineChance: number;
    /** Periodic banding strength. */
    banding: number;
  };
  preview: { widthPx: number; heightPx: number; overlay: boolean };
  enabled: boolean;
}

/** Any reader rig (config v3 discriminated union). */
export type CameraConfig = AreaScanCameraConfig | LineScanCameraConfig;

export interface FrameObservation {
  frameId: string;
  runId: string;
  cameraId: string;
  cameraState: CameraState;
  simTimeMs: number;
  encoderPositionMm: number;
  cameraSnapshot: CameraConfig;
  preview: { widthPx: number; heightPx: number; textureRef: string };
  candidateParcelIds: string[];
  labels: LabelObservation[];
  processingMode: ProcessingMode;
}

export interface LabelObservation {
  parcelId: string;
  labelInstanceId: string;
  /** Hidden from decoder logic; visible only in audit mode. */
  groundTruthPayload?: string;
  face: Face;
  projectedCornersPx: [number, number][];
  coverage: number;
  distanceMm: number;
  incidenceDeg: number;
  pixelsPerModule: number;
  blurPx: number;
  qualityComponents: Record<string, number>;
  decodedPayload?: string;
  confidence: number;
  reasons: string[];
}

export type ReasonCode =
  | 'OUT_OF_FOV'
  | 'BACK_FACING'
  | 'OCCLUDED'
  | 'LOW_PPM'
  | 'HIGH_ANGLE'
  | 'MOTION_BLUR'
  | 'GLARE'
  | 'LOW_CONTRAST'
  | 'OUT_OF_FOCUS'
  | 'CAMERA_FAULT';

/** A physical barcode label instance on a parcel face (PAR-005, REV-10). */
export interface LabelInstance {
  labelInstanceId: string;
  payload: string;
  face: Face;
  /** Offset of label centre from face centre, in face-local mm [u, v]. */
  localOffsetMm: [number, number];
  /** In-plane rotation, degrees. */
  rotationDeg: number;
  widthMm: number;
  heightMm: number;
  /**
   * Print damage 0..1 (PAR-007, IMG-010): 0 = clean; >0 bakes seeded
   * scuffs/creases into the label texture AND feeds the quality model's
   * damage component (issue #8).
   */
  damage: number;
}

export interface ParcelSpec {
  widthMm: number; // x — across belt
  heightMm: number; // y — up
  lengthMm: number; // z — travel
  lateralOffsetMm: number; // x offset of centre from belt centre
  yawDeg: number;
  material: MaterialPreset;
  tape: boolean;
  labels: LabelInstance[];
}

export type ParcelPhase = 'SPAWNED' | 'ENTERED' | 'EXITED' | 'SORTED';

export interface ParcelState {
  parcelId: string;
  spec: ParcelSpec;
  spawnSimTimeMs: number;
  spawnEncoderMm: number;
  frontZMm: number;
  phase: ParcelPhase;
  entrySimTimeMs?: number;
  exitSimTimeMs?: number;
  sortSimTimeMs?: number;
}

export interface FinalizedParcel {
  parcelId: string;
  spec: ParcelSpec;
  spawnSimTimeMs: number;
  entrySimTimeMs: number;
  exitSimTimeMs: number;
  sortSimTimeMs: number;
}

export type SimEvent =
  | { type: 'RUN_RESET'; simTimeMs: number; seed: number }
  | { type: 'PARCEL_SPAWNED'; parcelId: string; simTimeMs: number; encoderMm: number }
  | { type: 'PARCEL_ENTERED'; parcelId: string; simTimeMs: number; encoderMm: number }
  | { type: 'PARCEL_EXITED'; parcelId: string; simTimeMs: number; encoderMm: number }
  | { type: 'PARCEL_SORTED'; parcelId: string; simTimeMs: number; encoderMm: number }
  | {
      type: 'SPEED_CHANGED';
      simTimeMs: number;
      fromMmPerSec: number;
      toMmPerSec: number;
    }
  | {
      type: 'CAMERA_CAPTURED';
      cameraId: string;
      simTimeMs: number;
      candidateParcelIds: string[];
    }
  | {
      type: 'LINE_SCAN_STARTED';
      cameraId: string;
      parcelId: string;
      simTimeMs: number;
      encoderStartMm: number;
    }
  | {
      type: 'LINE_SCAN_COMPLETED';
      cameraId: string;
      parcelId: string;
      simTimeMs: number;
      encoderStartMm: number;
      encoderEndMm: number;
      lineCount: number;
      expectedLineCount: number;
      durationMs: number;
      /** Always true here; false trips emit LINE_SCAN_ABORTED. */
      complete: boolean;
    }
  | {
      type: 'LINE_SCAN_ABORTED';
      cameraId: string;
      parcelId: string;
      simTimeMs: number;
      encoderStartMm: number;
      encoderEndMm: number;
      lineCount: number;
      durationMs: number;
      /** Always false here. */
      complete: boolean;
      reason: 'CAMERA_FAULT' | 'CLOSE_SPACING' | 'MAX_STRIP';
    }
  | {
      type: 'PARCEL_FINALIZED';
      parcelId: string;
      simTimeMs: number;
      status: ParcelResultStatus;
    }
  | {
      type: 'PARCEL_ACKED';
      parcelId: string;
      simTimeMs: number;
    };

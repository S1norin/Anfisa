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

export interface CameraConfig {
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
  };
  preview: { widthPx: number; heightPx: number; overlay: boolean };
  enabled: boolean;
}

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
    };

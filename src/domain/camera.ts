/**
 * Camera rigs (CAM-001..CAM-004): pure domain logic.
 *
 * - Six default industrial readers positioned around the station (the poses
 *   are labelled demo assumptions, not an engineered layout).
 * - Pinhole intrinsics: focal length + film gauge + pixel grid → FOV and
 *   fx/fy. All distances in mm, pixels in sensor coordinates.
 * - Point projection + frustum corners for the scene helpers (CAM-003).
 * - The CAM-004 state machine as a pure transition function.
 * - CRUD + validation for rig lists (CAM-002, CFG-001, NFR-007).
 */

import type { ConfigError } from './config';
import type {
  AreaScanCameraConfig,
  CameraConfig,
  CameraRole,
  CameraState,
  LineScanCameraConfig,
} from './types';

// ---------------------------------------------------------------------------
// Minimal vector/quaternion math (domain stays THREE-free).

export type V3 = [number, number, number];

export function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Quaternion (x, y, z, w). */
export type Quat = [number, number, number, number];

export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** v' = q · v · q⁻¹ */
export function quatRotate(q: Quat, v: V3): V3 {
  // (q q*) · v — computed as two cross products (no allocation-heavy lib).
  const [x, y, z, w] = q;
  const t = [
    2 * (y * v[2] - z * v[1]),
    2 * (z * v[0] - x * v[2]),
    2 * (x * v[1] - y * v[0]),
  ];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
}

/**
 * Camera look-at quaternion: camera looks along +Z (OpenCV-style pinhole —
 * a point is in front iff its camera-space z > 0), +X right, +Y up, given
 * eye/target in mm and a world up. Matches toCameraSpace/projectPointMm.
 */
export function lookAtQuaternion(
  eye: V3,
  target: V3,
  up: V3 = [0, 1, 0],
): Quat {
  const zAxis = normalize([
    target[0] - eye[0],
    target[1] - eye[1],
    target[2] - eye[2],
  ]); // camera +Z = look direction
  const crossLen = (u: V3): number => {
    const c: V3 = [
      u[1] * zAxis[2] - u[2] * zAxis[1],
      u[2] * zAxis[0] - u[0] * zAxis[2],
      u[0] * zAxis[1] - u[1] * zAxis[0],
    ];
    return Math.hypot(c[0], c[1], c[2]);
  };
  // Straight up/down views make up ∥ z: fall back to a perpendicular up so
  // the camera basis stays orthonormal (TOP/BOTTOM readers).
  const refUp: V3 =
    crossLen(up) < 1e-9
      ? Math.abs(zAxis[1]) > 0.9
        ? [1, 0, 0]
        : [0, 1, 0]
      : up;
  const xAxis = normalize([
    refUp[1] * zAxis[2] - refUp[2] * zAxis[1],
    refUp[2] * zAxis[0] - refUp[0] * zAxis[2],
    refUp[0] * zAxis[1] - refUp[1] * zAxis[0],
  ]);
  const yAxis: V3 = [
    zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1],
    zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2],
    zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0],
  ];

  // Rotation matrix columns = xAxis, yAxis, zAxis → quaternion.
  const m11 = xAxis[0];
  const m12 = yAxis[0];
  const m13 = zAxis[0];
  const m21 = xAxis[1];
  const m22 = yAxis[1];
  const m23 = zAxis[1];
  const m31 = xAxis[2];
  const m32 = yAxis[2];
  const m33 = zAxis[2];
  const trace = m11 + m22 + m33;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m32 - m23) / s;
    y = (m13 - m31) / s;
    z = (m21 - m12) / s;
  } else if (m11 > m22 && m11 > m33) {
    const s = Math.sqrt(1 + m11 - m22 - m33) * 2;
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = Math.sqrt(1 + m22 - m11 - m33) * 2;
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    const s = Math.sqrt(1 + m33 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

// ---------------------------------------------------------------------------
// Default rigs (CAM-001, CAM-002).

export interface StationGeometry {
  /** Belt top at y=0, station spans z ∈ [0, lengthMm]. */
  lengthMm: number;
  beltWidthMm: number;
}

const STATION_CENTER_Z = (len: number) => len / 2;

/** Kind guards for the v3 discriminated union (CFG-007). */
export function isAreaScan(rig: CameraConfig): rig is AreaScanCameraConfig {
  return rig.kind === 'AREA_SCAN';
}

export function isLineScan(rig: CameraConfig): rig is LineScanCameraConfig {
  return rig.kind === 'LINE_SCAN';
}

/** All effects on (IMG-012); presets flip individual switches. */
export function defaultEffectToggles(): AreaScanCameraConfig['imageEffects']['toggles'] {
  return {
    motionBlur: true,
    focus: true,
    noise: true,
    exposure: true,
    glare: true,
    compression: true,
    lens: true,
  };
}

/**
 * The six default readers. Positions are demo assumptions chosen so every
 * role views the middle of the belt; not an engineered layout.
 */
export function defaultCameraRigs(
  station: StationGeometry,
  defaults: {
    sensorWidthPx: number;
    sensorHeightPx: number;
    focalLengthMm: number;
    exposureUs: number;
    fps: number;
    shutter: 'GLOBAL' | 'ROLLING';
  },
): AreaScanCameraConfig[] {
  const cz = STATION_CENTER_Z(station.lengthMm);
  const poses: { role: CameraConfig['role']; eye: V3; target: V3 }[] = [
    { role: 'FRONT', eye: [0, 1200, -900], target: [0, 0, 600] },
    { role: 'REAR', eye: [0, 1200, station.lengthMm + 900], target: [0, 0, station.lengthMm - 600] },
    { role: 'LEFT', eye: [-1200, 900, cz], target: [0, 0, cz] },
    { role: 'RIGHT', eye: [1200, 900, cz], target: [0, 0, cz] },
    { role: 'TOP', eye: [0, 2000, cz], target: [0, 0, cz] },
    // Bottom reader sits UNDER the belt (the station has a bottom opening
    // for side-grip transfer) and looks UP at the parcel bottom face (y=0).
    { role: 'BOTTOM', eye: [0, -400, cz], target: [0, 0, cz] },
  ];

  return poses.map((p, i) => ({
    kind: 'AREA_SCAN' as const,
    id: `CAM-${String(i + 1).padStart(3, '0')}`,
    name: `${p.role} reader`,
    role: p.role,
    pose: {
      positionMm: p.eye,
      quaternion: lookAtQuaternion(p.eye, p.target),
    },
    sensor: {
      widthPx: defaults.sensorWidthPx,
      heightPx: defaults.sensorHeightPx,
      focalLengthMm: defaults.focalLengthMm,
      filmGaugeMm: 23.5,
      nearMm: 50,
      farMm: 8000,
    },
    acquisition: {
      fps: defaults.fps,
      exposureUs: defaults.exposureUs,
      gainDb: 0,
      shutter: defaults.shutter,
      focusDistanceMm: 1000,
      rollingReadoutUs: 30000,
    },
    illumination: {
      intensity: 1.0,
      polarized: true,
      strobeUs: defaults.exposureUs,
      ambientLeak: 0.05,
    },
    optics: {
      apertureProxy: 4.0,
      radialDistortion: [0, 0],
      vignetting: 0,
    },
    imageEffects: {
      motionBlur: 'DIRECTIONAL',
      temporalSamples: 8,
      shotNoise: 0.15,
      readNoise: 0.05,
      compression: 0,
      artifactAmplification: 1,
      toggles: defaultEffectToggles(),
    },
    preview: { widthPx: 960, heightPx: 540, overlay: true },
    enabled: true,
  }));
}

/**
 * A line-scan rig with demo-assumption defaults (v3, LINE_SCAN). The
 * 8192 px × 512 mm line gives a 0.0625 mm pixel pitch across a 650 mm
 * belt; 0.1 mm/line encoder step gives ~4 travel lines per 0.4 mm module
 * (clears the default ppmMin 2.0); the 12 k lines/s ceiling saturates at
 * 1.2 m/s, so 1.5 m/s intentionally undersamples (LOW_PPM by design).
 */
export function defaultLineScanRig(
  id: string,
  role: CameraRole,
  positionMm: V3,
  quaternion: Quat,
  scanPlaneZMm: number,
  overrides?: Partial<LineScanCameraConfig['line']>,
): LineScanCameraConfig {
  return {
    kind: 'LINE_SCAN',
    id,
    name: `${role} line scanner`,
    role,
    pose: { positionMm, quaternion },
    line: {
      pixelsPerLine: 8192,
      sensorWidthMm: 512,
      encoderStepMmPerLine: 0.1,
      maxLineRateLinesPerSec: 12000,
      maxStripLengthMm: 5000,
      scanPlaneZMm,
      lineExposureUs: 100,
      ...overrides,
    },
    illumination: {
      intensity: 1.0,
      polarized: true,
      ambientLeak: 0.05,
    },
    imageEffects: {
      jitter: 0,
      missingLineChance: 0,
      banding: 0,
    },
    preview: { widthPx: 1280, heightPx: 720, overlay: true },
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Intrinsics & projection (CAM-003).

export interface PinholeIntrinsics {
  /** mm per pixel across the film gauge. */
  pixelPitchMm: number;
  sensorHeightMm: number;
  fovYDeg: number;
  aspect: number;
  /** Focal length in pixels (fx = fy for square pixels). */
  fx: number;
  fy: number;
  /** Principal point in sensor pixels (ROI-aware). */
  cx: number;
  cy: number;
}

export function sensorIntrinsics(
  s: AreaScanCameraConfig['sensor'],
): PinholeIntrinsics {
  const pixelPitchMm = s.filmGaugeMm / s.widthPx;
  const sensorHeightMm = s.heightPx * pixelPitchMm;
  const fovYDeg =
    (2 * Math.atan(sensorHeightMm / (2 * s.focalLengthMm)) * 180) / Math.PI;
  const fx = s.focalLengthMm / pixelPitchMm;
  const cx = s.roi ? s.roi.x + s.roi.width / 2 : s.widthPx / 2;
  const cy = s.roi ? s.roi.y + s.roi.height / 2 : s.heightPx / 2;
  return {
    pixelPitchMm,
    sensorHeightMm,
    fovYDeg,
    aspect: s.widthPx / s.heightPx,
    fx,
    fy: fx,
    cx,
    cy,
  };
}

/** World→camera transform: p_cam = R⁻¹(p − t). Pose-only (both kinds). */
export function toCameraSpace(p: V3, cfg: CameraConfig): V3 {
  const t = cfg.pose.positionMm;
  const rel: V3 = [p[0] - t[0], p[1] - t[1], p[2] - t[2]];
  return quatRotate(quatConjugate(cfg.pose.quaternion), rel);
}

/**
 * Project a world point (mm) into sensor pixels. null when the point is
 * behind the camera (z ≤ 0) or outside the sensor grid.
 */
export function projectPointMm(
  p: V3,
  cfg: AreaScanCameraConfig,
): { xPx: number; yPx: number; zMm: number } | null {
  const intr = sensorIntrinsics(cfg.sensor);
  const cam = toCameraSpace(p, cfg);
  if (cam[2] <= 0) return null;
  const xPx = intr.fx * (cam[0] / cam[2]) + intr.cx;
  const yPx = intr.cy - intr.fy * (cam[1] / cam[2]);
  if (
    xPx < 0 ||
    xPx >= cfg.sensor.widthPx ||
    yPx < 0 ||
    yPx >= cfg.sensor.heightPx
  ) {
    return null;
  }
  return { xPx, yPx, zMm: cam[2] };
}

/** The eight frustum corners (near×4 then far×4) in world mm. */
export function frustumCornersMm(cfg: AreaScanCameraConfig): V3[] {
  const intr = sensorIntrinsics(cfg.sensor);
  const halfW = (cfg.sensor.widthPx / 2) * intr.pixelPitchMm;
  const halfH = (cfg.sensor.heightPx / 2) * intr.pixelPitchMm;
  const cornersCam: V3[] = [];
  for (const z of [cfg.sensor.nearMm, cfg.sensor.farMm]) {
    for (const [x, y] of [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ] as [number, number][]) {
      cornersCam.push([x, y, z]);
    }
  }
  const t = cfg.pose.positionMm;
  const q = cfg.pose.quaternion;
  return cornersCam.map((c) => [
    t[0] + quatRotate(q, c)[0],
    t[1] + quatRotate(q, c)[1],
    t[2] + quatRotate(q, c)[2],
  ]);
}

// ---------------------------------------------------------------------------
// State machine (CAM-004).

export type CameraStateEvent =
  | { type: 'ENABLE' }
  | { type: 'DISABLE' }
  | { type: 'FAULT_RAISED' }
  | { type: 'FAULT_CLEARED' }
  | { type: 'TRIGGER_ZONE_ACTIVE' }
  | { type: 'TRIGGER_ZONE_INACTIVE' }
  | { type: 'CAPTURE_STARTED' }
  | { type: 'CAPTURE_FINISHED' }
  | { type: 'PROCESSING_FINISHED' };

/**
 * Pure transition table. Unknown (state, event) combinations are no-ops —
 * the machine never throws; callers that need strictness check the result.
 */
export function nextCameraState(
  state: CameraState,
  event: CameraStateEvent,
): CameraState {
  switch (event.type) {
    case 'DISABLE':
      return 'OFFLINE';
    case 'ENABLE':
      return state === 'OFFLINE' ? 'IDLE' : state;
    case 'FAULT_RAISED':
      return state === 'FAULT' || state === 'OFFLINE' ? state : 'FAULT';
    case 'FAULT_CLEARED':
      return state === 'FAULT' ? 'IDLE' : state;
    case 'TRIGGER_ZONE_ACTIVE':
      return state === 'IDLE' ? 'ARMED' : state;
    case 'TRIGGER_ZONE_INACTIVE':
      return state === 'ARMED' ? 'IDLE' : state;
    case 'CAPTURE_STARTED':
      return state === 'ARMED' ? 'CAPTURING' : state;
    case 'CAPTURE_FINISHED':
      return state === 'CAPTURING' ? 'PROCESSING' : state;
    case 'PROCESSING_FINISHED':
      return state === 'PROCESSING' ? 'IDLE' : state;
  }
}

/** CAM-005 precondition (health/scheduling land with issues #6/#9). */
export function canCapture(cfg: CameraConfig, state: CameraState): boolean {
  return cfg.enabled && state === 'ARMED';
}

/** Sync runtime per-rig states from the rig list (used on config edits). */
export function syncCameraStates(
  rigs: CameraConfig[],
  prev: Record<string, CameraState>,
): Record<string, CameraState> {
  const next: Record<string, CameraState> = {};
  for (const rig of rigs) {
    if (rig.enabled) {
      next[rig.id] = prev[rig.id] === 'OFFLINE' ? 'IDLE' : (prev[rig.id] ?? 'IDLE');
    } else {
      next[rig.id] = 'OFFLINE';
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// CRUD (CAM-002).

export function nextCameraId(rigs: CameraConfig[]): string {
  let max = 0;
  for (const r of rigs) {
    const m = r.id.match(/^CAM-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CAM-${String(max + 1).padStart(3, '0')}`;
}

export function addCameraRig(
  rigs: CameraConfig[],
  rig: CameraConfig,
): CameraConfig[] {
  if (rigs.some((r) => r.id === rig.id)) {
    throw new Error(`Camera id already exists: ${rig.id}`);
  }
  return [...rigs, rig];
}

export function cloneCameraRig(
  rigs: CameraConfig[],
  id: string,
  newId: string,
  newName?: string,
): CameraConfig[] {
  const src = rigs.find((r) => r.id === id);
  if (!src) throw new Error(`No camera with id: ${id}`);
  const clone: CameraConfig = structuredClone(src);
  clone.id = newId;
  clone.name = newName ?? `${src.name} (copy)`;
  return addCameraRig(rigs, clone);
}

export function removeCameraRig(
  rigs: CameraConfig[],
  id: string,
): CameraConfig[] {
  return rigs.filter((r) => r.id !== id);
}

export function moveCameraRig(
  rigs: CameraConfig[],
  id: string,
  positionMm: V3,
  quaternion: Quat,
): CameraConfig[] {
  return rigs.map((r) =>
    r.id === id
      ? { ...r, pose: { positionMm, quaternion } }
      : r,
  );
}

export function setCameraRigEnabled(
  rigs: CameraConfig[],
  id: string,
  enabled: boolean,
): CameraConfig[] {
  return rigs.map((r) => (r.id === id ? { ...r, enabled } : r));
}

// ---------------------------------------------------------------------------
// Validation (CFG-001, NFR-007).

export function validateCameraRigs(rigs: CameraConfig[]): ConfigError[] {
  const errors: ConfigError[] = [];
  const seen = new Set<string>();
  const num = (v: unknown, path: string, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push({ path, message: 'must be a finite number' });
    } else if (v < min || v > max) {
      errors.push({ path, message: `must be within [${min}, ${max}]` });
    }
  };

  rigs.forEach((r, i) => {
    const p = (k: string) => `cameraRigs[${i}].${k}`;
    if (!r.id || seen.has(r.id)) {
      errors.push({ path: p('id'), message: 'must be a non-empty unique id' });
    }
    seen.add(r.id);
    if (!r.name) errors.push({ path: p('name'), message: 'must not be empty' });

    const pos = r.pose.positionMm;
    for (const [k, v] of pos.entries()) {
      if (!Number.isFinite(v)) errors.push({ path: p(`pose.positionMm[${k}]`), message: 'must be finite' });
    }
    const qn = Math.hypot(
      r.pose.quaternion[0],
      r.pose.quaternion[1],
      r.pose.quaternion[2],
      r.pose.quaternion[3],
    );
    if (qn < 0.9 || qn > 1.1) {
      errors.push({ path: p('pose.quaternion'), message: 'must be normalized' });
    }
    num(r.preview.widthPx, p('preview.widthPx'), 16, 4096);
    num(r.preview.heightPx, p('preview.heightPx'), 16, 4096);

    if (r.kind !== 'AREA_SCAN' && r.kind !== 'LINE_SCAN') {
      errors.push({
        path: p('kind'),
        message: "must be 'AREA_SCAN' or 'LINE_SCAN'",
      });
      return;
    }

    if (r.kind === 'AREA_SCAN') {

    num(r.sensor.widthPx, p('sensor.widthPx'), 64, 12000);
    num(r.sensor.heightPx, p('sensor.heightPx'), 64, 12000);
    num(r.sensor.focalLengthMm, p('sensor.focalLengthMm'), 2, 120);
    num(r.sensor.filmGaugeMm, p('sensor.filmGaugeMm'), 4, 50);
    num(r.sensor.nearMm, p('sensor.nearMm'), 1, 1000);
    num(r.sensor.farMm, p('sensor.farMm'), 10, 100000);
    if (r.sensor.farMm <= r.sensor.nearMm) {
      errors.push({ path: p('sensor.farMm'), message: 'must exceed nearMm' });
    }
    const roi = r.sensor.roi;
    if (roi) {
      num(roi.x, p('sensor.roi.x'), 0, r.sensor.widthPx);
      num(roi.y, p('sensor.roi.y'), 0, r.sensor.heightPx);
      num(roi.width, p('sensor.roi.width'), 8, r.sensor.widthPx);
      num(roi.height, p('sensor.roi.height'), 8, r.sensor.heightPx);
      if (roi.x + roi.width > r.sensor.widthPx || roi.y + roi.height > r.sensor.heightPx) {
        errors.push({
          path: p('sensor.roi'),
          message: 'must lie inside the sensor',
        });
      }
    }

    num(r.acquisition.fps, p('acquisition.fps'), 1, 240);
    num(r.acquisition.exposureUs, p('acquisition.exposureUs'), 1, 100000);
    num(r.acquisition.gainDb, p('acquisition.gainDb'), -20, 60);
    num(r.acquisition.focusDistanceMm, p('acquisition.focusDistanceMm'), 1, 100000);
    num(r.acquisition.rollingReadoutUs, p('acquisition.rollingReadoutUs'), 0, 100000);

    num(r.illumination.intensity, p('illumination.intensity'), 0, 2);
    num(r.illumination.strobeUs, p('illumination.strobeUs'), 0, 100000);
    num(r.illumination.ambientLeak, p('illumination.ambientLeak'), 0, 1);

    num(r.optics.apertureProxy, p('optics.apertureProxy'), 0.5, 22);
    num(r.optics.vignetting, p('optics.vignetting'), 0, 1);

    num(r.imageEffects.temporalSamples, p('imageEffects.temporalSamples'), 2, 32);
    num(r.imageEffects.shotNoise, p('imageEffects.shotNoise'), 0, 1);
    num(r.imageEffects.readNoise, p('imageEffects.readNoise'), 0, 1);
    num(r.imageEffects.compression, p('imageEffects.compression'), 0, 1);
    num(
      r.imageEffects.artifactAmplification,
      p('imageEffects.artifactAmplification'),
      1,
      16,
    );
    const toggles = r.imageEffects.toggles;
    for (const key of [
      'motionBlur',
      'focus',
      'noise',
      'exposure',
      'glare',
      'compression',
      'lens',
    ] as const) {
      if (typeof toggles?.[key] !== 'boolean') {
        errors.push({
          path: p(`imageEffects.toggles.${key}`),
          message: 'must be a boolean',
        });
      }
    }

    } else {
      // Area-only blocks are invalid on line rigs (v2 leak / bad import).
      const extra = (['sensor', 'acquisition', 'optics'] as const).filter(
        (k) => k in (r as CameraConfig),
      );
      for (const k of extra) {
        errors.push({ path: p(k), message: 'is not allowed on LINE_SCAN rigs' });
      }
      num(r.line.pixelsPerLine, p('line.pixelsPerLine'), 64, 65536);
      num(r.line.sensorWidthMm, p('line.sensorWidthMm'), 50, 2000);
      num(r.line.encoderStepMmPerLine, p('line.encoderStepMmPerLine'), 0.01, 10);
      num(r.line.maxLineRateLinesPerSec, p('line.maxLineRateLinesPerSec'), 100, 100000);
      num(r.line.maxStripLengthMm, p('line.maxStripLengthMm'), 10, 20000);
      num(r.line.scanPlaneZMm, p('line.scanPlaneZMm'), 0, 10000);
      num(r.line.lineExposureUs, p('line.lineExposureUs'), 1, 100000);
      num(r.illumination.intensity, p('illumination.intensity'), 0, 2);
      num(r.illumination.ambientLeak, p('illumination.ambientLeak'), 0, 1);
      num(r.imageEffects.jitter, p('imageEffects.jitter'), 0, 1);
      num(r.imageEffects.missingLineChance, p('imageEffects.missingLineChance'), 0, 1);
      num(r.imageEffects.banding, p('imageEffects.banding'), 0, 1);
    }
  });

  return errors;
}

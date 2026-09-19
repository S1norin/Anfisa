/**
 * Geometric label observation (PIPE-001, PIPE-002): face orientation,
 * frustum inclusion, projected corners, coverage, distance, incidence.
 *
 * Pure mm-space math (THREE-free, deterministic, headless-testable).
 * The face-local conventions match `scene/label.ts` exactly (u/v axes per
 * face, +z outward normal, in-plane spin about the normal, parcel yaw
 * about world +Y), so the observed geometry agrees with the rendered
 * label plane.
 *
 * PIPE-002: pixels-per-module comes from the PHYSICAL sensor model
 * (focal length + film gauge + pixel grid), never the preview resolution.
 */

import { sensorIntrinsics, toCameraSpace } from '../domain/camera';
import { degToRad } from '../domain/units';
import type { CameraConfig, Face, LabelInstance, ParcelState } from '../domain/types';

export type V3 = [number, number, number];

// ---------------------------------------------------------------------------
// World-space label geometry (mm)
// ---------------------------------------------------------------------------

/** Parcel centre in world mm. */
export function parcelCentreWorldMm(p: ParcelState): V3 {
  const s = p.spec;
  return [s.lateralOffsetMm, s.heightMm / 2, p.frontZMm - s.lengthMm / 2];
}

/**
 * Face centre, outward normal and in-plane axes (u, v) in world mm —
 * before yaw (apply `yawRotateMm` for the full transform).
 */
export function faceFrameLocalMm(
  face: Face,
  spec: ParcelState['spec'],
): { center: V3; normal: V3; u: V3; v: V3 } {
  const W = spec.widthMm / 2;
  const H = spec.heightMm / 2;
  const L = spec.lengthMm / 2;
  switch (face) {
    case 'FRONT':
      return { center: [0, 0, L], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] };
    case 'REAR':
      return { center: [0, 0, -L], normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] };
    case 'LEFT':
      return { center: [-W, 0, 0], normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] };
    case 'RIGHT':
      return { center: [W, 0, 0], normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] };
    case 'TOP':
      return { center: [0, H, 0], normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] };
    case 'BOTTOM':
      return { center: [0, -H, 0], normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] };
  }
}

/** Rotate a parcel-local vector by the parcel yaw (about world +Y). */
export function yawRotateMm(local: V3, yawDeg: number): V3 {
  const φ = degToRad(yawDeg);
  const c = Math.cos(φ);
  const s = Math.sin(φ);
  return [local[0] * c + local[2] * s, local[1], -local[0] * s + local[2] * c];
}

function toWorld(local: V3, centre: V3, yawDeg: number): V3 {
  const r = yawRotateMm(local, yawDeg);
  return [centre[0] + r[0], centre[1] + r[1], centre[2] + r[2]];
}

/** Outward face normal in world mm (unit). */
export function faceNormalWorldMm(
  face: Face,
  parcel: ParcelState,
): V3 {
  const s = parcel.spec;
  return yawRotateMm(faceFrameLocalMm(face, s).normal, s.yawDeg);
}

/** Label centre in world mm. */
export function labelCenterWorldMm(
  label: LabelInstance,
  parcel: ParcelState,
): V3 {
  const s = parcel.spec;
  const f = faceFrameLocalMm(label.face, s);
  const local: V3 = [
    f.center[0] + label.localOffsetMm[0],
    f.center[1] + label.localOffsetMm[1],
    f.center[2],
  ];
  return toWorld(local, parcelCentreWorldMm(parcel), s.yawDeg);
}

/**
 * The four label corners in world mm, CCW from the (−u, −v) corner as seen
 * from outside the face. In-plane rotation is about the face normal.
 */
export function labelCornersWorldMm(
  label: LabelInstance,
  parcel: ParcelState,
): [V3, V3, V3, V3] {
  const s = parcel.spec;
  const f = faceFrameLocalMm(label.face, s);
  const θ = degToRad(label.rotationDeg);
  const c = Math.cos(θ);
  const sn = Math.sin(θ);
  const centre = parcelCentreWorldMm(parcel);
  const hw = label.widthMm / 2;
  const hh = label.heightMm / 2;
  const pts: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const corner = ([px, py]: [number, number]): V3 => {
    const u = px * c - py * sn;
    const v = px * sn + py * c;
    const local: V3 = [
      f.center[0] + label.localOffsetMm[0] + f.u[0] * u + f.v[0] * v,
      f.center[1] + label.localOffsetMm[1] + f.u[1] * u + f.v[1] * v,
      f.center[2] + f.u[2] * u + f.v[2] * v,
    ];
    return toWorld(local, centre, s.yawDeg);
  };
  return [corner(pts[0]), corner(pts[1]), corner(pts[2]), corner(pts[3])];
}

// ---------------------------------------------------------------------------
// Projection (physical sensor, PIPE-002)
// ---------------------------------------------------------------------------

export interface ProjectedLabel {
  /** Sensor-pixel corners; null entries are behind the camera. */
  cornersPx: ({ xPx: number; yPx: number; zMm: number } | null)[];
  /** All four corners in front of the camera. */
  inFov: boolean;
  /** Face normal points toward the camera. */
  frontFacing: boolean;
  /** Camera → label centre distance, mm. */
  distanceMm: number;
  /** 0° = head-on (normal ∥ view), 90° = edge-on. */
  incidenceDeg: number;
  /**
   * Fraction of the label's projected area inside the sensor grid
   * (Sutherland–Hodgman clip; 1 = fully visible, 0 = none).
   */
  coverage: number;
  /** Projected label width in sensor pixels (mean of the two u-edges). */
  widthPx: number;
}

/**
 * Project a label against a rig's physical sensor (no ROI cropping — the
 * sensor grid is what the decoder sees; ROI belongs to later processing).
 */
export function projectLabelMm(
  rig: CameraConfig,
  label: LabelInstance,
  parcel: ParcelState,
): ProjectedLabel {
  const intr = sensorIntrinsics(rig.sensor);
  const cornersWorld = labelCornersWorldMm(label, parcel);
  const centre = labelCenterWorldMm(label, parcel);
  const camPos = rig.pose.positionMm;

  const cornersPx = cornersWorld.map((p) => {
    const cam = toCameraSpace(p, rig);
    if (cam[2] <= 0) return null;
    return {
      xPx: intr.fx * (cam[0] / cam[2]) + intr.cx,
      yPx: intr.cy - intr.fy * (cam[1] / cam[2]),
      zMm: cam[2],
    };
  });

  const dist = Math.hypot(
    centre[0] - camPos[0],
    centre[1] - camPos[1],
    centre[2] - camPos[2],
  );
  const n = faceNormalWorldMm(label.face, parcel);
  const toCam: V3 = [
    (camPos[0] - centre[0]) / (dist || 1),
    (camPos[1] - centre[1]) / (dist || 1),
    (camPos[2] - centre[2]) / (dist || 1),
  ];
  const cos = n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2];
  const incidenceDeg =
    (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;

  const inFov = cornersPx.every((c) => c != null);
  const frontFacing = cos > 0;

  let coverage = 0;
  let widthPx = 0;
  if (inFov) {
    const pts = cornersPx.map((c) => [c!.xPx, c!.yPx] as [number, number]);
    const original = Math.abs(shoelace(pts));
    const clipped = clipToRect(pts, 0, 0, rig.sensor.widthPx, rig.sensor.heightPx);
    coverage = original > 1e-9 ? Math.min(1, Math.abs(shoelace(clipped)) / original) : 0;
    // Mean of the two u-edges (corner order: (−u,−v) → (+u,−v) → (+u,+v) → (−u,+v)).
    const e1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    const e2 = Math.hypot(pts[2][0] - pts[3][0], pts[2][1] - pts[3][1]);
    widthPx = (e1 + e2) / 2;
  }

  return { cornersPx, inFov, frontFacing, distanceMm: dist, incidenceDeg, coverage, widthPx };
}

/** Absolute shoelace area of a polygon (pixel units²). */
function shoelace(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Sutherland–Hodgman: clip a convex polygon to an axis-aligned rect. */
function clipToRect(
  pts: [number, number][],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): [number, number][] {
  const edges: ((pt: [number, number]) => number)[] = [
    (pt) => pt[0] - minX,
    (pt) => maxX - pt[0],
    (pt) => pt[1] - minY,
    (pt) => maxY - pt[1],
  ];
  let poly = pts;
  for (const inside of edges) {
    const out: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = inside(a);
      const db = inside(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    poly = out;
    if (poly.length === 0) break;
  }
  return poly;
}

/**
 * Schema-view geometry (issue #13): pure world-space data for the
 * low-clutter dimensioned view — dimension lines (the six key dimensions),
 * camera scan zones, optical axes, focus planes, angle arcs (incidence +
 * parcel yaw), and per-label annotations (face normal, distance line,
 * projected size). All values are in world millimetres; the R3F layer
 * (schemaScene.tsx) converts to metres and draws.
 *
 * Everything is a pure function of (config, parcels, selection) so it can
 * be unit-tested without WebGL.
 */

import { quatRotate, type Quat } from '../domain/camera';
import type { V3 } from '../domain/camera';

export type { V3 };
import {
  faceNormalWorldMm,
  labelCenterWorldMm,
  parcelCentreWorldMm,
  projectLabelMm,
} from '../observation/projection';
import type { AreaScanCameraConfig, CameraConfig, LineScanCameraConfig, ParcelState } from '../domain/types';
import type { SimConfig } from '../domain/config';
import { getStationDimensions } from './stationGeometry';

// ---------------------------------------------------------------------------
// Dimension lines
// ---------------------------------------------------------------------------

export interface DimLine {
  id: string;
  /** e.g. "Station length — 2200 mm" */
  label: string;
  from: V3;
  to: V3;
  /** World offset applied to the line midpoint for the label anchor. */
  labelOffset: V3;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * The six key dimensions (issue #13):
 *  1. conveyor (belt) width   2. station length
 *  3. working distance (top camera → belt top)
 *  4. parcel size             5. bottom opening
 *  6. sorter distance (exit → sort point)
 */
export function dimensionLines(
  cfg: SimConfig,
  parcel: ParcelState | null,
): DimLine[] {
  const d = getStationDimensions(cfg);
  const L = d.stationLengthMm;
  const W = d.beltWidthMm;
  const mid = L / 2;
  const lines: DimLine[] = [];

  // 1. Belt width — just above the belt top, near the entry.
  lines.push({
    id: 'belt-width',
    label: `Conveyor width — ${W} mm`,
    from: [-W / 2 - 40, 8, 120],
    to: [W / 2 + 40, 8, 120],
    labelOffset: [0, 90, 0],
  });

  // 2. Station length — offset in -x, along the full station.
  lines.push({
    id: 'station-length',
    label: `Station length — ${L} mm`,
    from: [-(W / 2 + 260), -20, 0],
    to: [-(W / 2 + 260), -20, L],
    labelOffset: [-140, -60, 0],
  });

  // 3. Working distance — top camera lens to belt top (vertical).
  const topRig = cfg.cameraRigs.find((r) => r.role === 'TOP');
  if (topRig) {
    lines.push({
      id: 'working-distance',
      label: `Working distance — ${d.workingDistanceMm} mm`,
      from: [...topRig.pose.positionMm] as V3,
      to: [topRig.pose.positionMm[0], 0, mid],
      labelOffset: [160, d.workingDistanceMm / 2, 0],
    });
  }

  // 4. Parcel size — lateral span across the selected parcel.
  if (parcel) {
    const c = parcelCentreWorldMm(parcel);
    const halfW = parcel.spec.widthMm / 2 + 60;
    lines.push({
      id: 'parcel-size',
      label: `Parcel — ${parcel.spec.widthMm} × ${parcel.spec.heightMm} × ${parcel.spec.lengthMm} mm`,
      from: [c[0] - halfW, c[1], c[2]],
      to: [c[0] + halfW, c[1], c[2]],
      labelOffset: [0, parcel.spec.heightMm / 2 + 120, 0],
    });
  }

  // 5. Bottom opening — along the exposed bottom face at station centre.
  lines.push({
    id: 'bottom-opening',
    label: `Bottom opening — ${d.bottomOpeningMm} mm`,
    from: [-d.bottomOpeningMm / 2, -14, mid],
    to: [d.bottomOpeningMm / 2, -14, mid],
    labelOffset: [0, -100, 0],
  });

  // 6. Sorter distance — exit photoeye to the sort point.
  lines.push({
    id: 'sorter-distance',
    label: `Sorter distance — ${d.sortDistanceMm} mm`,
    from: [W / 2 + 120, -20, L],
    to: [W / 2 + 120, -20, d.sortPointZMm],
    labelOffset: [120, -70, 0],
  });

  return lines;
}

// ---------------------------------------------------------------------------
// Scan zones, optical axes, focus planes
// ---------------------------------------------------------------------------

/** Vertical FOV (deg) of a rig's physical pinhole model. */
export function rigVFovDeg(rig: AreaScanCameraConfig): number {
  const s = rig.sensor;
  return (2 * Math.atan(s.filmGaugeMm / 2 / s.focalLengthMm) * 180) / Math.PI;
}

export interface ScanZone {
  rigId: string;
  /** e.g. "CAM-001 · FRONT" */
  label: string;
  /** World centre of the zone box (at the focus point). */
  center: V3;
  /** Box half-extents in the camera's local frame (x right, y up, z fwd). */
  halfExtentsLocal: V3;
  quaternion: Quat;
}

/**
 * A rig's scan zone: the region between the lens and the focus plane,
 * sized from the frustum at the focus distance.
 */
export function scanZones(rigs: CameraConfig[]): ScanZone[] {
  return rigs
    // Line scanners have no area frustum; they get dedicated plane
    // annotations (t10).
    .filter((r): r is AreaScanCameraConfig => r.enabled && r.kind === 'AREA_SCAN')
    .map((rig) => {
      const fwd = localAxes(rig.pose.quaternion).z;
      const dist = rig.acquisition.focusDistanceMm;
      const aspect = rig.sensor.widthPx / rig.sensor.heightPx;
      const halfH = dist * Math.tan((rigVFovDeg(rig) * Math.PI) / 360);
      const center = add(
        rig.pose.positionMm,
        scale(fwd, dist / 2),
      );
      return {
        rigId: rig.id,
        label: `${rig.id} · ${rig.role}`,
        center,
        halfExtentsLocal: [halfH * aspect, halfH, dist / 2],
        quaternion: rig.pose.quaternion,
      };
    });
}

/** Optical axis: lens → focus point, per rig (along the camera's own axis). */
export function opticalAxes(rigs: CameraConfig[]): {
  rigId: string;
  from: V3;
  to: V3;
}[] {
  return rigs
    .filter((r): r is AreaScanCameraConfig => r.enabled && r.kind === 'AREA_SCAN')
    .map((rig) => {
      const dist = rig.acquisition.focusDistanceMm;
      return {
        rigId: rig.id,
        from: [...rig.pose.positionMm] as V3,
        to: add(rig.pose.positionMm, scale(localAxes(rig.pose.quaternion).z, dist)),
      };
    });
}

/**
 * Focus plane rectangle corners (world mm) at the rig's focus distance:
 * the physical image-plane size at that range, oriented like the camera.
 */
export function focusPlaneCorners(rig: AreaScanCameraConfig): V3[] {
  const dist = rig.acquisition.focusDistanceMm;
  const aspect = rig.sensor.widthPx / rig.sensor.heightPx;
  const halfH = dist * Math.tan((rigVFovDeg(rig) * Math.PI) / 360);
  const p = rig.pose.positionMm;
  const cornersLocal: V3[] = [
    [-halfH * aspect, -halfH, dist],
    [halfH * aspect, -halfH, dist],
    [halfH * aspect, halfH, dist],
    [-halfH * aspect, halfH, dist],
  ];
  // Camera-local axes from the pose quaternion (local x/y/z in world).
  const { x: qx, y: qy, z: qz } = localAxes(rig.pose.quaternion);
  return cornersLocal.map(([x, y, z]) => [
    p[0] + qx[0] * x + qy[0] * y + qz[0] * z,
    p[1] + qx[1] * x + qy[1] * y + qz[1] * z,
    p[2] + qx[2] * x + qy[2] * y + qz[2] * z,
  ]);
}

/**
 * Camera-local unit axes expressed in world space — computed with the
 * domain's own quatRotate (the same transform toCameraSpace projects with),
 * so annotation geometry is consistent with the pipeline by construction.
 */
function localAxes(q: Quat): { x: V3; y: V3; z: V3 } {
  return {
    x: quatRotate(q, [1, 0, 0]),
    y: quatRotate(q, [0, 1, 0]),
    z: quatRotate(q, [0, 0, 1]),
  };
}

/**
 * Line-scan rig annotation (t10): the thin scan plane (sensor width × slab
 * at the encoder-synced scanPlaneZMm, deck level y = 0) plus the optical
 * axis from the rig to the plane centre, and the label text carrying the
 * new line fields (sensor width, px/line, plane Z). Pure world-mm data;
 * the R3F layer draws it.
 */
export interface LineScanAnnotation {
  rigId: string;
  /** e.g. "CAM-005 · TOP — line scan" */
  label: string;
  /** e.g. "512 mm sensor · 1024 px/line · plane Z 1100 mm" */
  sub: string;
  /** Scan plane corners (world mm): sensor-width span × thin slab. */
  planeCorners: V3[];
  /** Optical axis: rig position → scan plane centre. */
  axis: { from: V3; to: V3 };
}

export function lineScanAnnotations(rigs: CameraConfig[]): LineScanAnnotation[] {
  return rigs
    .filter((r): r is LineScanCameraConfig => r.enabled && r.kind === 'LINE_SCAN')
    .map((rig) => {
      const p = rig.pose.positionMm;
      const axes = localAxes(rig.pose.quaternion);
      const halfW = rig.line.sensorWidthMm / 2;
      const eps = 2; // slab half-thickness along the travel axis (mm)
      const center: V3 = [p[0], 0, rig.line.scanPlaneZMm];
      const corner = (sy: number, sx: number): V3 => [
        center[0] + axes.y[0] * halfW * sy + axes.x[0] * eps * sx,
        center[1] + axes.y[1] * halfW * sy + axes.x[1] * eps * sx,
        center[2] + axes.y[2] * halfW * sy + axes.x[2] * eps * sx,
      ];
      return {
        rigId: rig.id,
        label: `${rig.id} · ${rig.role} — line scan`,
        sub: `${rig.line.sensorWidthMm} mm sensor · ${rig.line.pixelsPerLine} px/line · plane Z ${rig.line.scanPlaneZMm} mm`,
        planeCorners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
        axis: { from: [...p] as V3, to: center },
      };
    });
}

/**
 * Sensor ROI rectangle (world mm) on the near plane, when the rig has an
 * ROI configured. ROI units are sensor pixels (x right, y down from top).
 */
export function roiCorners(rig: AreaScanCameraConfig): V3[] | null {
  const roi = rig.sensor.roi;
  if (!roi) return null;
  // Match sensorIntrinsics: pixel pitch from film gauge on the short edge.
  const pitch =
    rig.sensor.filmGaugeMm / Math.max(rig.sensor.widthPx, rig.sensor.heightPx);
  const cornersPx: [number, number][] = [
    [roi.x, roi.y],
    [roi.x + roi.width, roi.y],
    [roi.x + roi.width, roi.y + roi.height],
    [roi.x, roi.y + roi.height],
  ];
  const centrePx: [number, number] = [
    rig.sensor.widthPx / 2,
    rig.sensor.heightPx / 2,
  ];
  const z = rig.sensor.nearMm;
  const p = rig.pose.positionMm;
  const { x: qx, y: qy, z: qz } = localAxes(rig.pose.quaternion);
  return cornersPx.map(([px, py]) => {
    const x = (px - centrePx[0]) * pitch;
    // y up in camera space; sensor y is down from the top edge.
    const y = (centrePx[1] - py) * pitch;
    return [
      p[0] + qx[0] * x + qy[0] * y + qz[0] * z,
      p[1] + qx[1] * x + qy[1] * y + qz[1] * z,
      p[2] + qx[2] * x + qy[2] * y + qz[2] * z,
    ];
  });
}

// ---------------------------------------------------------------------------
// Angle arcs
// ---------------------------------------------------------------------------

export interface AngleArc {
  id: string;
  label: string;
  /** Polyline points (world mm), first/last are the arc endpoints. */
  points: V3[];
}

/**
 * Incidence-angle arc at a label centre: sweeps from the face normal toward
 * the camera direction in the plane they span.
 */
export function incidenceArc(
  center: V3,
  faceNormal: V3,
  camPos: V3,
  radiusMm: number,
): AngleArc {
  const toCam = norm(add(camPos, scale(center, -1)));
  let cos =
    faceNormal[0] * toCam[0] + faceNormal[1] * toCam[1] + faceNormal[2] * toCam[2];
  cos = Math.min(1, Math.max(-1, cos));
  const theta = Math.acos(cos);
  if (theta < 0.001) {
    // Degenerate (head-on): a point, not an arc.
    return {
      id: 'incidence',
      label: 'Incidence 0°',
      points: [add(center, scale(faceNormal, radiusMm))],
    };
  }
  // Axis of the rotation plane = n × v (normalised).
  const ax =
    faceNormal[1] * toCam[2] - faceNormal[2] * toCam[1];
  const ay =
    faceNormal[2] * toCam[0] - faceNormal[0] * toCam[2];
  const az =
    faceNormal[0] * toCam[1] - faceNormal[1] * toCam[0];
  const al = Math.hypot(ax, ay, az) || 1;
  const axis: V3 = [ax / al, ay / al, az / al];
  const steps = 24;
  const points: V3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = theta * (i / steps);
    // Rodrigues: v cos t + (k×v) sin t + k (k·v) (1 - cos t).
    const c = Math.cos(t);
    const s = Math.sin(t);
    const k = axis;
    const v = faceNormal;
    const kv = [
      k[1] * v[2] - k[2] * v[1],
      k[2] * v[0] - k[0] * v[2],
      k[0] * v[1] - k[1] * v[0],
    ];
    const kdv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    const p: V3 = [
      v[0] * c + kv[0] * s + k[0] * kdv * (1 - c),
      v[1] * c + kv[1] * s + k[1] * kdv * (1 - c),
      v[2] * c + kv[2] * s + k[2] * kdv * (1 - c),
    ];
    points.push(add(center, scale(p, radiusMm)));
  }
  const deg = (theta * 180) / Math.PI;
  return {
    id: 'incidence',
    label: `Incidence ${deg.toFixed(1)}°`,
    points,
  };
}

/**
 * Parcel yaw arc: horizontal sweep at the parcel centre from the +z travel
 * axis to the parcel's yawed long axis.
 */
export function yawArc(parcel: ParcelState): AngleArc {
  const c = parcelCentreWorldMm(parcel);
  const r = 140;
  const yaw = (parcel.spec.yawDeg * Math.PI) / 180;
  const steps = 24;
  const points: V3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = yaw * (i / steps);
    points.push([c[0] + r * Math.sin(t), c[1], c[2] + r * Math.cos(t)]);
  }
  return {
    id: 'yaw',
    label: `Yaw ${parcel.spec.yawDeg.toFixed(1)}°`,
    points,
  };
}

// ---------------------------------------------------------------------------
// Label annotations (selected parcel + one camera)
// ---------------------------------------------------------------------------

export interface LabelAnnotation {
  labelInstanceId: string;
  center: V3;
  /** Face normal, unit, and its drawn endpoint (center + n·len). */
  normal: V3;
  normalEnd: V3;
  /** Label centre → camera lens, with the distance label. */
  distanceLine: { from: V3; to: V3; label: string };
  /** Projected size on the rig's sensor, e.g. "118 × 62 px". */
  projected: string;
  incidenceDeg: number;
  /** True when the label is fully inside the sensor grid. */
  inFov: boolean;
}

/**
 * Annotations for every label on the parcel as seen by the given rig:
 * face normal, distance-to-camera line, projected size (from the same
 * physical projection the pipeline uses).
 */
export function labelAnnotations(
  rig: AreaScanCameraConfig,
  parcel: ParcelState,
): LabelAnnotation[] {
  const camPos = rig.pose.positionMm;
  return parcel.spec.labels.map((label) => {
    const center = labelCenterWorldMm(label, parcel);
    const n = faceNormalWorldMm(label.face, parcel);
    const projected = projectLabelMm(rig, label, parcel);
    const dist = Math.hypot(
      center[0] - camPos[0],
      center[1] - camPos[1],
      center[2] - camPos[2],
    );
    return {
      labelInstanceId: label.labelInstanceId,
      center,
      normal: n,
      normalEnd: add(center, scale(n, 220)),
      distanceLine: {
        from: center,
        to: camPos,
        label: `${Math.round(dist)} mm`,
      },
      projected: `${Math.round(projected.widthPx)} px wide`,
      incidenceDeg: projected.incidenceDeg,
      inFov: projected.inFov,
    };
  });
}

/**
 * Schema-view geometry (issue #13): the six dimension lines, scan zones,
 * focus planes, ROI corners, angle arcs, and label annotations are pure
 * functions of (config, parcel, rig) — tested without WebGL.
 */

import { defaultCameraRigs } from '../domain/camera';
import { defaultConfig } from '../domain/config';
import type { AreaScanCameraConfig, CameraConfig, ParcelState } from '../domain/types';
import {
  dimensionLines,
  focusPlaneCorners,
  incidenceArc,
  labelAnnotations,
  opticalAxes,
  rigVFovDeg,
  roiCorners,
  scanZones,
  yawArc,
  type V3,
} from './schemaData';

const STATION = { lengthMm: 2200, beltWidthMm: 650 };

function config(): ReturnType<typeof defaultConfig> {
  const cfg = defaultConfig();
  cfg.station.lengthMm = STATION.lengthMm;
  cfg.belt.widthMm = STATION.beltWidthMm;
  cfg.cameraRigs = defaultCameraRigs(STATION, {
    sensorWidthPx: 2448,
    sensorHeightPx: 2048,
    focalLengthMm: 16,
    exposureUs: 75,
    fps: 30,
    shutter: 'GLOBAL',
  });
  return cfg;
}

function rig(role: string): AreaScanCameraConfig {
  return config().cameraRigs.find((r): r is AreaScanCameraConfig => r.role === role)!;
}

function makeParcel(over: Partial<ParcelState> = {}): ParcelState {
  return {
    parcelId: 'P-001',
    spec: {
      widthMm: 400,
      heightMm: 120,
      lengthMm: 300,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [
        {
          labelInstanceId: 'L-0001',
          payload: 'KTY-12345678901234',
          face: 'FRONT',
          localOffsetMm: [0, 0],
          rotationDeg: 0,
          widthMm: 78,
          heightMm: 25,
          damage: 0,
        },
      ],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm: 1350, // centre at z = 1200
    phase: 'SPAWNED',
    ...over,
  };
}

describe('dimensionLines — the six key dimensions', () => {
  it('returns all six line ids with config-driven extents', () => {
    const cfg = config();
    const lines = dimensionLines(cfg, null);
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(Object.keys(byId).sort()).toEqual([
      'belt-width',
      'bottom-opening',
      'sorter-distance',
      'station-length',
      'working-distance',
    ]);
    // Belt width spans the belt plus extension, at fixed height.
    const w = byId['belt-width'];
    expect(w.to[0] - w.from[0]).toBe(STATION.beltWidthMm + 80);
    expect(byId['station-length'].to[2] - byId['station-length'].from[2]).toBe(
      STATION.lengthMm,
    );
    expect(byId['sorter-distance'].to[2] - byId['sorter-distance'].from[2]).toBe(
      cfg.station.sortDistanceMm,
    );
    // Parcel dimension appears only with a selected parcel.
    expect(byId['parcel-size']).toBeUndefined();
  });

  it('adds the parcel size line for the selected parcel', () => {
    const cfg = config();
    const parcel = makeParcel();
    const lines = dimensionLines(cfg, parcel);
    const ps = lines.find((l) => l.id === 'parcel-size')!;
    expect(ps.label).toContain('400 × 120 × 300');
    expect(ps.to[0] - ps.from[0]).toBe(400 + 120);
  });

  it('bottom opening follows the transfer mode', () => {
    const cfg = config();
    const gap = dimensionLines(cfg, null).find(
      (l) => l.id === 'bottom-opening',
    )!;
    const gapWidth = gap.to[0] - gap.from[0];
    expect(gapWidth).toBeGreaterThan(0);
    // GAP mode exposes a fixed 100 mm opening; SIDE_GRIP the full deck.
    cfg.station.bottomTransfer = 'GAP';
    const gap2 = dimensionLines(cfg, null).find(
      (l) => l.id === 'bottom-opening',
    )!;
    expect(gap2.to[0] - gap2.from[0]).toBeLessThan(gapWidth);
  });
});

describe('scan zones, optical axes, focus planes', () => {
  it('one scan zone per enabled rig, centred at half the focus distance', () => {
    const cfg = config();
    const zones = scanZones(cfg.cameraRigs);
    expect(zones).toHaveLength(cfg.cameraRigs.length);
    for (const zone of zones) {
      const r = cfg.cameraRigs.find((x) => x.id === zone.rigId)! as AreaScanCameraConfig;
      const d = r.acquisition.focusDistanceMm;
      // Zone centre = camera + fwd·d/2 (fwd from the pose quaternion, so
      // oblique rigs are covered by the distance invariant).
      const dist = Math.hypot(
        zone.center[0] - r.pose.positionMm[0],
        zone.center[1] - r.pose.positionMm[1],
        zone.center[2] - r.pose.positionMm[2],
      );
      expect(dist).toBeCloseTo(d / 2, 6);
      expect(zone.halfExtentsLocal[2]).toBeCloseTo(d / 2, 6);
      expect(zone.halfExtentsLocal[0]).toBeGreaterThan(0);
      expect(zone.label).toContain(r.id);
    }
  });

  it('optical axis runs from the lens to the focus point along the rig axis', () => {
    const r = rig('FRONT');
    const axes = opticalAxes([r]);
    expect(axes).toHaveLength(1);
    expect(axes[0].from).toEqual(r.pose.positionMm);
    const dx = axes[0].to[0] - axes[0].from[0];
    const dy = axes[0].to[1] - axes[0].from[1];
    const dz = axes[0].to[2] - axes[0].from[2];
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(r.acquisition.focusDistanceMm, 6);
  });

  it('focus plane is a rectangle centred at the focus point (TOP looks down)', () => {
    const r = rig('TOP');
    const c = focusPlaneCorners(r);
    expect(c).toHaveLength(4);
    const d = r.acquisition.focusDistanceMm;
    const cx = c.reduce((s, p) => s + p[0], 0) / 4;
    const cy = c.reduce((s, p) => s + p[1], 0) / 4;
    const cz = c.reduce((s, p) => s + p[2], 0) / 4;
    // TOP rig: eye above the station centre looking straight down.
    expect(cz).toBeCloseTo(r.pose.positionMm[2], 6);
    expect(cx).toBeCloseTo(r.pose.positionMm[0], 6);
    expect(cy).toBeCloseTo(r.pose.positionMm[1] - d, 6);
    // All corners equidistant from the centre (rectangle).
    const dists = c.map((p) => Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
    expect(dists[1]).toBeCloseTo(dists[0], 9);
  });

  it('vFOV grows when the focal length shrinks', () => {
    const r = rig('FRONT');
    const wide = { ...r, sensor: { ...r.sensor, focalLengthMm: 8 } };
    expect(rigVFovDeg(wide)).toBeGreaterThan(rigVFovDeg(r));
  });

  it('ROI corners sit on the near plane and vanish without an ROI', () => {
    const r = rig('FRONT');
    expect(roiCorners(r)).toBeNull();
    const withRoi: CameraConfig = {
      ...r,
      sensor: {
        ...r.sensor,
        roi: { x: 0, y: 0, width: r.sensor.widthPx / 2, height: r.sensor.heightPx / 2 },
      },
    };
    const c = roiCorners(withRoi)!;
    expect(c).toHaveLength(4);
    const set = new Set(c.map((p) => p.join(',')));
    expect(set.size).toBe(4);
    // Rectangle: opposite edges equal, diagonals equal.
    const seg = (a: V3, b: V3) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(seg(c[0], c[1])).toBeCloseTo(seg(c[3], c[2]), 6);
    expect(seg(c[1], c[2])).toBeCloseTo(seg(c[0], c[3]), 6);
    expect(seg(c[0], c[2])).toBeCloseTo(seg(c[1], c[3]), 6);
  });
});

describe('angle arcs', () => {
  it('incidence arc is degenerate at head-on and 90° at edge-on', () => {
    const center: V3 = [0, 0, 0];
    const normal: V3 = [0, 0, 1];
    // Camera on +z: head-on.
    const head = incidenceArc(center, normal, [0, 0, 500], 100);
    expect(head.points).toHaveLength(1);
    expect(head.label).toContain('0°');
    // Camera on +x: edge-on (90°).
    const edge = incidenceArc(center, normal, [500, 0, 0], 100);
    expect(edge.points.length).toBeGreaterThan(10);
    expect(edge.label).toContain('90');
    // Endpoint sits on the camera direction at the arc radius.
    const last = edge.points[edge.points.length - 1];
    expect(Math.hypot(last[0], last[1], last[2])).toBeCloseTo(100, 6);
  });

  it('yaw arc sweeps from the travel axis to the yawed long axis', () => {
    const p = makeParcel({ spec: { ...makeParcel().spec, yawDeg: 0 } });
    const a = yawArc(p);
    const centre = [0, 60, 1200] as V3;
    expect(a.points[0]).toEqual([centre[0], centre[1], centre[2] + 140]);
    const p90 = makeParcel({ spec: { ...makeParcel().spec, yawDeg: 90 } });
    const b = yawArc(p90);
    expect(b.points[b.points.length - 1][0]).toBeCloseTo(centre[0] + 140, 6);
  });
});

describe('label annotations', () => {
  it('annotates every label: normal, distance line, projected size', () => {
    const parcel = makeParcel();
    const cam = rig('FRONT');
    const anns = labelAnnotations(cam, parcel);
    expect(anns).toHaveLength(1);
    const a = anns[0];
    expect(a.labelInstanceId).toBe('L-0001');
    // FRONT face is the leading edge: +z normal, along the travel axis.
    expect(a.normal[2]).toBeGreaterThan(0);
    expect(a.normalEnd[2] > a.center[2]).toBe(true);
    // Distance line runs label → lens with a rounded-mm label.
    expect(a.distanceLine.to).toEqual(cam.pose.positionMm);
    expect(a.distanceLine.label).toMatch(/^\d+ mm$/);
    expect(a.projected).toMatch(/px/);
    expect(a.incidenceDeg).toBeGreaterThanOrEqual(0);
    expect(a.incidenceDeg).toBeLessThanOrEqual(180);
  });
});

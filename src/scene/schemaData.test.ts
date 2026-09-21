/**
 * Schema-view geometry (issue #13): the six dimension lines, scan zones,
 * focus planes, ROI corners, angle arcs, and label annotations are pure
 * functions of (config, parcel, rig) — tested without WebGL.
 */

import { reportEightReaderConfig, reportSixViewConfig } from '../capture/presets';
import { defaultCameraRigs } from '../domain/camera';
import { defaultConfig } from '../domain/config';
import type {
  AreaScanCameraConfig,
  CameraConfig,
  LineScanCameraConfig,
  ParcelState,
} from '../domain/types';
import {
  dimensionLines,
  focusPlaneCorners,
  incidenceArc,
  labelAnnotations,
  lineScanAnnotations,
  opticalAxes,
  rigVFovDeg,
  roiCorners,
  scanZones,
  sideRingAnnotation,
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

describe('dimensionLines — the seven key dimensions', () => {
  it('returns all seven line ids with config-driven extents', () => {
    const cfg = config();
    const lines = dimensionLines(cfg, null);
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(Object.keys(byId).sort()).toEqual([
      'belt-width',
      'bottom-opening',
      'bottom-working-distance',
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

describe('line-scan annotations (t10)', () => {
  function lineRig(role: 'TOP' | 'BOTTOM'): LineScanCameraConfig {
    const cfg = reportSixViewConfig();
    const rig = cfg.cameraRigs.find(
      (r): r is LineScanCameraConfig => r.role === role && r.kind === 'LINE_SCAN',
    );
    if (!rig) throw new Error(`report layout has no ${role} line scanner`);
    return rig;
  }

  it('annotates each enabled LINE_SCAN rig: plane at scanPlaneZMm + rig → plane axis', () => {
    const cfg = reportSixViewConfig();
    const anns = lineScanAnnotations(cfg.cameraRigs);
    expect(anns).toHaveLength(2);
    for (const a of anns) {
      const rig = cfg.cameraRigs.find((r) => r.id === a.rigId)! as LineScanCameraConfig;
      // The plane spans the sensor width.
      const span = Math.hypot(
        a.planeCorners[1][0] - a.planeCorners[0][0],
        a.planeCorners[1][1] - a.planeCorners[0][1],
        a.planeCorners[1][2] - a.planeCorners[0][2],
      );
      expect(span).toBeCloseTo(rig.line.fovWidthMm, 6);
      // The plane sits at the encoder-synced scanPlaneZMm (deck level
      // y = 0), with at most the 2 mm slab half-thickness along travel.
      for (const c of a.planeCorners) {
        expect(Math.abs(c[2] - rig.line.scanPlaneZMm)).toBeLessThanOrEqual(2);
        expect(c[1]).toBeCloseTo(0, 6);
      }
      // The axis runs from the rig to the plane centre.
      expect(a.axis.from).toEqual(rig.pose.positionMm);
      expect(a.axis.to[2]).toBeCloseTo(rig.line.scanPlaneZMm, 6);
      // The label carries the new line fields.
      expect(a.label).toContain(rig.id);
      expect(a.sub).toContain(String(rig.line.fovWidthMm));
      expect(a.sub).toContain(String(rig.line.scanPlaneZMm));
    }
  });

  it('area-only helpers stay area-only on a mixed rig list (no crash)', () => {
    const cfg = reportSixViewConfig();
    const areaIds = cfg.cameraRigs.filter((r) => r.kind === 'AREA_SCAN').map((r) => r.id);
    expect(scanZones(cfg.cameraRigs).map((z) => z.rigId)).toEqual(areaIds);
    expect(opticalAxes(cfg.cameraRigs)).toHaveLength(areaIds.length);
  });

  it('disabled line rigs get no annotation; a moved scan plane follows', () => {
    const cfg = reportSixViewConfig();
    const rigs = cfg.cameraRigs.map((r) =>
      r.kind === 'LINE_SCAN' && r.role === 'TOP' ? { ...r, enabled: false } : r,
    );
    const anns = lineScanAnnotations(rigs);
    expect(anns).toHaveLength(1);
    expect(anns[0].rigId).toBe(lineRig('BOTTOM').id);

    const moved = lineRig('BOTTOM');
    const withMoved: CameraConfig = {
      ...moved,
      line: { ...moved.line, scanPlaneZMm: 300 },
    };
    const a = lineScanAnnotations([withMoved])[0];
    expect(a.planeCorners.every((c) => Math.abs(c[2] - 300) <= 2)).toBe(true);
    expect(a.sub).toContain('plane Z 300 mm');
  });
});

describe('t3-schema: report-8reader layout annotations', () => {
  it('shows the 60° side ring with 30° worst-case and 1450 mm working distance', () => {
    const cfg = reportEightReaderConfig();
    const ring = sideRingAnnotation(cfg)!;
    expect(ring).not.toBeNull();
    expect(ring.label).toContain('60°');
    expect(ring.label).toContain('6 directions');
    expect(ring.sub).toContain('30°');
    expect(ring.sub).toContain('1450 mm');
    expect(ring.anglesDeg).toHaveLength(6);
    expect(ring.radiusMm).toBeCloseTo(1650, 0);
  });

  it('top/bottom working distances are measured from the rig poses (150 mm / 100 mm)', () => {
    const cfg = reportEightReaderConfig();
    const parcel = makeParcel();
    parcel.spec.heightMm = 400; // the report preset targets 400 mm parcels
    const lines = dimensionLines(cfg, parcel);
    const top = lines.find((d) => d.id === 'working-distance')!;
    expect(top.label).toContain('150 mm');
    const bottom = lines.find((d) => d.id === 'bottom-working-distance')!;
    expect(bottom.label).toContain('100 mm');
  });

  it('line annotations report the 715 mm FOV, not the 41 mm physical sensor', () => {
    const cfg = reportEightReaderConfig();
    const anns = lineScanAnnotations(cfg.cameraRigs);
    expect(anns).toHaveLength(2);
    for (const a of anns) {
      expect(a.sub).toContain('715 mm FOV');
    }
  });

  it('returns null for non-ring layouts (recommended 6-view)', () => {
    expect(sideRingAnnotation(reportSixViewConfig())).toBeNull();
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

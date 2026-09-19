/**
 * Geometric label observation (PIPE-001, PIPE-002): world-space label
 * corners, frustum inclusion, projected corners, coverage, distance,
 * incidence angle — against the PHYSICAL sensor model.
 */

import { defaultCameraRigs } from '../domain/camera';
import { defaultConfig } from '../domain/config';
import type { CameraConfig, LabelInstance, ParcelState } from '../domain/types';
import {
  faceNormalWorldMm,
  labelCenterWorldMm,
  labelCornersWorldMm,
  parcelCentreWorldMm,
  projectLabelMm,
  yawRotateMm,
} from './projection';

const STATION = { lengthMm: 3000, beltWidthMm: 600 };
const DEFAULTS = {
  sensorWidthPx: 2448,
  sensorHeightPx: 2048,
  focalLengthMm: 16,
  exposureUs: 75,
  fps: 30,
  shutter: 'GLOBAL' as const,
};

function rig(role: string): CameraConfig {
  return defaultCameraRigs(STATION, DEFAULTS).find((r) => r.role === role)!;
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
      labels: [],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm: 1650, // centre at z = 1500 (station middle)
    phase: 'SPAWNED',
    ...over,
  };
}

function makeLabel(over: Partial<LabelInstance> = {}): LabelInstance {
  return {
    labelInstanceId: 'L-0001',
    payload: 'KTY-12345678901234',
    face: 'FRONT',
    localOffsetMm: [0, 0],
    rotationDeg: 0,
    widthMm: 78,
    heightMm: 25,
    damage: 0,
    ...over,
  };
}

describe('world-space label geometry', () => {
  it('parcel centre sits on the belt axis at frontZ - length/2', () => {
    const p = makeParcel();
    expect(parcelCentreWorldMm(p)).toEqual([0, 60, 1500]);
  });

  it('face normals are unit and point outward per face', () => {
    const p = makeParcel();
    const expectN: Record<string, [number, number, number]> = {
      FRONT: [0, 0, 1],
      REAR: [0, 0, -1],
      LEFT: [-1, 0, 0],
      RIGHT: [1, 0, 0],
      TOP: [0, 1, 0],
      BOTTOM: [0, -1, 0],
    };
    for (const [face, n] of Object.entries(expectN)) {
      const got = faceNormalWorldMm(face as 'FRONT', p);
      expect(got).toEqual(n);
      expect(Math.hypot(...got)).toBeCloseTo(1, 9);
    }
  });

  it('yaw rotates the face normal about +Y (z → x for +90°)', () => {
    const p = makeParcel({ spec: { ...makeParcel().spec, yawDeg: 90 } });
    const front = faceNormalWorldMm('FRONT', p);
    expect(front).toEqual([expect.closeTo(1, 10), 0, expect.closeTo(0, 10)]);
    const left = faceNormalWorldMm('LEFT', p);
    expect(left).toEqual([expect.closeTo(0, 10), 0, expect.closeTo(1, 10)]);
  });

  it('label centre = face centre + offset, rotated by yaw', () => {
    const p = makeParcel();
    expect(labelCenterWorldMm(makeLabel(), p)).toEqual([0, 60, 1650]);
    const offset = makeLabel({ localOffsetMm: [10, 5] });
    expect(labelCenterWorldMm(offset, p)).toEqual([10, 65, 1650]);
  });

  it('label corners: axis-aligned, right size, on the face plane', () => {
    const p = makeParcel();
    const corners = labelCornersWorldMm(makeLabel(), p);
    // FRONT face at z = 1650, corners at ±39 (u=x), ±12.5 (v=y).
    expect(corners).toEqual([
      [-39, 47.5, 1650],
      [39, 47.5, 1650],
      [39, 72.5, 1650],
      [-39, 72.5, 1650],
    ]);
  });

  it('label corners rotate in-plane about the face normal', () => {
    const p = makeParcel();
    const rotated = labelCornersWorldMm(makeLabel({ rotationDeg: 90 }), p);
    // 90°: the long edge (0→1) becomes vertical. Corner 0 was (−hw, −hh):
    // (px,py)=(−39,−12.5) rotated 90°: u = px·cos − py·sin = 12.5, v = px·sin + py·cos = −39.
    expect(rotated[0]).toEqual([
      expect.closeTo(12.5, 9),
      expect.closeTo(60 - 39, 9),
      expect.closeTo(1650, 9),
    ]);
    // Edge 0→1 spans the label width (78) along v now.
    const du = Math.hypot(
      rotated[1][0] - rotated[0][0],
      rotated[1][1] - rotated[0][1],
    );
    expect(du).toBeCloseTo(78, 9);
    // Edge 1→2 spans the label height (25) along u.
    const du2 = Math.hypot(
      rotated[2][0] - rotated[1][0],
      rotated[2][1] - rotated[1][1],
    );
    expect(du2).toBeCloseTo(25, 9);
  });

  it('yawRotateMm matches the THREE +Y convention (z → x for +90°)', () => {
    const r = yawRotateMm([0, 5, 10], 90);
    expect(r).toEqual([expect.closeTo(10, 10), 5, expect.closeTo(0, 10)]);
  });
});

describe('projectLabelMm (PIPE-001, PIPE-002)', () => {
  it('REAR-face label seen by the FRONT rig: in FOV, front-facing, full coverage', () => {
    // The FRONT rig sits upstream (−z), so it photographs the parcel's −z face.
    const p = makeParcel();
    const proj = projectLabelMm(rig('FRONT'), makeLabel({ face: 'REAR' }), p);
    expect(proj.inFov).toBe(true);
    expect(proj.frontFacing).toBe(true);
    expect(proj.incidenceDeg).toBeLessThan(30);
    expect(proj.coverage).toBeCloseTo(1, 6);
    expect(proj.distanceMm).toBeGreaterThan(0);
    // Corners lie on the sensor grid.
    for (const c of proj.cornersPx) {
      expect(c!.xPx).toBeGreaterThanOrEqual(0);
      expect(c!.xPx).toBeLessThanOrEqual(2448);
      expect(c!.yPx).toBeGreaterThanOrEqual(0);
      expect(c!.yPx).toBeLessThanOrEqual(2048);
    }
  });

  it('BACK-FACING: a FRONT (+z) label is not front-facing to the FRONT rig', () => {
    const p = makeParcel();
    const proj = projectLabelMm(rig('FRONT'), makeLabel(), p);
    expect(proj.frontFacing).toBe(false);
  });

  it('OUT OF FOV: a label behind the camera is not in the frustum', () => {
    const behind = makeParcel({ frontZMm: -2000 }); // far behind the FRONT rig
    const proj = projectLabelMm(rig('FRONT'), makeLabel(), behind);
    expect(proj.inFov).toBe(false);
  });

  it('partial coverage: a label clipped by the sensor edge projects < 1', () => {
    const p = makeParcel();
    // Push the parcel right so the label's right edge crosses the sensor border.
    const proj = projectLabelMm(
      rig('FRONT'),
      makeLabel({ face: 'REAR' }),
      makeParcel({ spec: { ...p.spec, lateralOffsetMm: 1811 } }),
    );
    expect(proj.coverage).toBeGreaterThan(0.3);
    expect(proj.coverage).toBeLessThan(0.8);
  });

  it('incidence: head-on for TOP face seen by the TOP reader, ~90° for a side face', () => {
    const p = makeParcel();
    const headOn = projectLabelMm(rig('TOP'), makeLabel({ face: 'TOP' }), p);
    const edgeOn = projectLabelMm(rig('TOP'), makeLabel({ face: 'LEFT' }), p);
    expect(headOn.incidenceDeg).toBeLessThan(5);
    expect(edgeOn.incidenceDeg).toBeGreaterThan(85);
  });

  it('widthPx uses the physical sensor (PIPE-002): a 78 mm label ~2.7 m away, 16 mm lens', () => {
    const p = makeParcel();
    const proj = projectLabelMm(rig('FRONT'), makeLabel({ face: 'REAR' }), p);
    // fx ≈ 1666.7 px (23.5 mm gauge / 2448 px), optical-axis distance ≈ 2468 mm:
    // 78 mm → 78 × 1666.7 / 2468 ≈ 52.8 px.
    expect(proj.widthPx).toBeGreaterThan(45);
    expect(proj.widthPx).toBeLessThan(60);
  });

  it('distance to the FRONT rig matches the geometric expectation', () => {
    const p = makeParcel();
    const proj = projectLabelMm(rig('FRONT'), makeLabel({ face: 'REAR' }), p);
    // eye (0,1200,−900) → label centre (0,60,1350): √(1140² + 2250²)
    expect(proj.distanceMm).toBeCloseTo(Math.hypot(1140, 2250), 3);
  });
});

describe('default config thresholds stay consistent (editable, §8)', () => {
  it('quality defaults match the spec examples', () => {
    const q = defaultConfig().quality;
    expect(q.coverageMin).toBe(0.92);
    expect(q.ppmMin).toBe(2.0);
    expect(q.ppmTarget).toBe(3.0);
    expect(q.blurPxMax).toBe(1.0);
    expect(q.blurPxTarget).toBe(0.5);
    expect(q.incidenceDegMax).toBe(60);
    expect(q.incidenceDegTarget).toBe(35);
  });
});

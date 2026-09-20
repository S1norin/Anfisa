/**
 * Camera Lab report (issue #12): the readout must match the physical
 * pinhole model and the pipeline's own observation engine.
 */
import { describe, expect, it } from 'vitest';
import {
  recommendedSixViewConfig,
  reportEightReaderConfig,
} from '../../capture/presets';
import type { AreaScanCameraConfig, LabelInstance, ParcelState } from '../../domain/types';
import {
  REPORT_SIDE,
  sideFovWidthMm,
  sideObjectMmPerPixel,
  worstCaseIncidenceDeg,
} from '../../report/reportSpec';
import {
  computeLabReport,
  lookAtPoint,
  lookTargetMm,
  reportSideOptics,
  vFovDeg,
} from './labReport';

function testParcel(): ParcelState {
  const topLabel: LabelInstance = {
    labelInstanceId: 'LAB-LBL-1',
    payload: 'TEST-TOP-0001',
    face: 'TOP',
    localOffsetMm: [0, 0],
    rotationDeg: 0,
    widthMm: 100,
    heightMm: 50,
    damage: 0,
  };
  const frontLabel: LabelInstance = {
    labelInstanceId: 'LAB-LBL-2',
    payload: 'TEST-FRONT-0002',
    face: 'FRONT',
    localOffsetMm: [0, 0],
    rotationDeg: 0,
    widthMm: 100,
    heightMm: 50,
    damage: 0,
  };
  return {
    parcelId: 'LAB-PAR-1',
    spec: {
      widthMm: 400,
      heightMm: 400,
      lengthMm: 600,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [topLabel, frontLabel],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm: 1400, // centre at z = 1400 − 300 = 1100 = station centre
    phase: 'ENTERED',
  };
}

describe('vFovDeg', () => {
  it('derives from focal length and film gauge', () => {
    const rig = recommendedSixViewConfig().cameraRigs[0] as AreaScanCameraConfig;
    const s = rig.sensor;
    const expected = (2 * Math.atan(s.filmGaugeMm / 2 / s.focalLengthMm) * 180) / Math.PI;
    expect(vFovDeg(rig)).toBeCloseTo(expected, 6);
  });

  it('longer focal → narrower FOV', () => {
    const cfg = recommendedSixViewConfig();
    const rig = cfg.cameraRigs[0] as AreaScanCameraConfig;
    const narrow = {
      ...rig,
      sensor: { ...rig.sensor, focalLengthMm: rig.sensor.focalLengthMm * 2 },
    };
    expect(vFovDeg(narrow)).toBeLessThan(vFovDeg(rig));
  });
});

describe('computeLabReport', () => {
  const cfg = recommendedSixViewConfig();
  const areaRig = (role: string): AreaScanCameraConfig =>
    cfg.cameraRigs.find((r): r is AreaScanCameraConfig => r.role === role)!;

  it('TOP rig: distance matches geometry, top label is in-FOV, high PPM', () => {
    const rig = areaRig('TOP');
    const parcel = testParcel();
    const report = computeLabReport(
      rig,
      'IDLE',
      parcel,
      [parcel],
      0,
      0,
      cfg,
    );

    // Camera at y = 400 + 900, parcel centre at y = 200 → 1100 mm.
    expect(report.distanceMm).toBeCloseTo(1100, 3);

    const top = report.labels.find((l) => l.face === 'TOP')!;
    expect(top.coverage).toBeCloseTo(1, 3);
    expect(top.incidenceDeg).toBeLessThan(5);
    expect(top.pixelsPerModule).toBeGreaterThan(2);
    expect(top.blurPx).toBe(0);
    expect(top.reasons).not.toContain('OUT_OF_FOV');
    expect(top.reasons).not.toContain('BACK_FACING');
    expect(top.reasons).not.toContain('LOW_PPM');
  });

  it('camera fault → CAMERA_FAULT reason, zero quality', () => {
    const rig = areaRig('TOP');
    const parcel = testParcel();
    const report = computeLabReport(rig, 'FAULT', parcel, [parcel], 0, 0, cfg);
    expect(report.best!.reasons).toContain('CAMERA_FAULT');
    expect(report.best!.qualityPassed).toBe(false);
  });

  it('aimed the other way → OUT_OF_FOV / BACK_FACING reasons', () => {
    const rig = areaRig('TOP');
    const parcel = testParcel();
    // Aim 180° away: straight UP from a top camera → label behind the lens.
    const flipped = {
      ...rig,
      pose: {
        ...rig.pose,
        quaternion: lookAtPoint(rig, [0, 1300 + 5000, 1100]).quaternion,
      },
    };
    const report = computeLabReport(flipped, 'IDLE', parcel, [parcel], 0, 0, cfg);
    const top = report.labels.find((l) => l.face === 'TOP')!;
    expect(top.coverage).toBe(0);
    expect(top.reasons).toContain('OUT_OF_FOV');
  });

  it('blur scales with belt speed', () => {
    const rig = areaRig('FRONT');
    const parcel = testParcel();
    const slow = computeLabReport(rig, 'IDLE', parcel, [parcel], 0, 100, cfg);
    const fast = computeLabReport(rig, 'IDLE', parcel, [parcel], 0, 1000, cfg);
    const frontSlow = slow.labels.find((l) => l.face === 'FRONT')!;
    const frontFast = fast.labels.find((l) => l.face === 'FRONT')!;
    expect(frontFast.blurPx).toBeGreaterThan(frontSlow.blurPx);
  });
});

// ---------------------------------------------------------------------------
// t2-optics: report-8reader side rig — the report check derives the
// reportSpec pinhole values from the rig's own sensor + focus numbers.
// ---------------------------------------------------------------------------
describe('reportSideOptics (t2-optics: report-8reader side rig)', () => {
  const cfg = reportEightReaderConfig();
  const rig = cfg.cameraRigs.find(
    (r): r is AreaScanCameraConfig =>
      r.kind === 'AREA_SCAN' && r.name.includes('RIGHT 90°'),
  )!;

  it('derives mm/px, worst-case ppm and FOV from the rig sensor + focus', () => {
    const r = reportSideOptics(rig, cfg);
    const s = REPORT_SIDE;
    // Object-space pitch: 55 × (36/8000) / (1450 − 55) ≈ 0.1141 mm/px.
    expect(r.mmPerPx).toBeCloseTo(
      sideObjectMmPerPixel(s.focalLengthMm, s.pixelPitchMm, s.workingDistanceMm),
      6,
    );
    expect(r.mmPerPx).toBeCloseTo(0.1141, 3);
    // 0.35 mm module → 3.07 px at 0°, 3.54 px at 30° ≥ ppmMin 2.0.
    expect(r.ppmAt0Deg).toBeCloseTo(3.07, 1);
    expect(r.ppmAtWorstDeg).toBeCloseTo(3.54, 2);
    expect(r.ppmAtWorstDeg).toBeGreaterThanOrEqual(cfg.quality.ppmMin);
    expect(r.ppmOk).toBe(true);
    // Horizontal FOV at the focus plane ≈ 949 mm → covers the 400 mm parcel.
    expect(r.fovWidthMm).toBeCloseTo(
      sideFovWidthMm(s.focalLengthMm, s.filmGaugeWidthMm, s.workingDistanceMm),
      6,
    );
    expect(r.fovWidthMm).toBeGreaterThan(cfg.parcel.widthMm);
    expect(r.worstIncidenceDeg).toBeCloseTo(
      worstCaseIncidenceDeg(s.directionSpacingDeg),
      6,
    );
  });

  it('the engine PPM shown by the lab report matches the helper (±5%)', () => {
    const rightLabel: LabelInstance = {
      labelInstanceId: 'LAB-RIGHT',
      payload: 'TEST-RIGHT-0001',
      face: 'RIGHT',
      localOffsetMm: [0, 0],
      rotationDeg: 0,
      widthMm: 78,
      heightMm: 25,
      damage: 0,
    };
    const parcel: ParcelState = {
      parcelId: 'LAB-PAR-8R',
      spec: {
        widthMm: 400,
        heightMm: 400,
        lengthMm: 600,
        lateralOffsetMm: 0,
        yawDeg: 0,
        material: 'KRAFT',
        tape: false,
        labels: [rightLabel],
      },
      spawnSimTimeMs: 0,
      spawnEncoderMm: 0,
      frontZMm: 1100, // centre at z = 800 → face centre at the aim z
      phase: 'ENTERED',
    };
    const report = computeLabReport(rig, 'IDLE', parcel, [parcel], 0, 1000, cfg);
    const helper = reportSideOptics(rig, cfg);
    const right = report.labels.find((l) => l.face === 'RIGHT')!;
    expect(
      Math.abs(right.pixelsPerModule - helper.ppmAt0Deg) / helper.ppmAt0Deg,
    ).toBeLessThan(0.05);
  });
});

describe('lookTargetMm / lookAtPoint', () => {
  it('round-trips: aim at a point, the look target returns to it', () => {
    const cfg = recommendedSixViewConfig();
    const rig = cfg.cameraRigs.find(
      (r): r is AreaScanCameraConfig => r.role === 'TOP',
    )!;
    const point: [number, number, number] = [50, 200, 1100];
    const aimed = {
      ...rig,
      pose: {
        positionMm: rig.pose.positionMm,
        quaternion: lookAtPoint(rig, point).quaternion,
      },
    };
    // Slant distance from the TOP lens (0, 1300, 1100) to the point.
    const slant = Math.hypot(point[0], point[1] - 1300, point[2] - 1100);
    const target = lookTargetMm(aimed, slant);
    expect(target[0]).toBeCloseTo(point[0], 6);
    expect(target[1]).toBeCloseTo(point[1], 6);
    expect(target[2]).toBeCloseTo(point[2], 6);
  });
});

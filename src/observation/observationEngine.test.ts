/**
 * Observation engine (PIPE-001..005): assembles LabelObservations from the
 * pure geometric modules. Fixtures use the real default rig layout.
 */

import { defaultCameraRigs, lookAtQuaternion, sensorIntrinsics, toCameraSpace } from '../domain/camera';
import { defaultConfig } from '../domain/config';
import type { AreaScanCameraConfig, LabelInstance, ParcelState } from '../domain/types';
import { labelMotionBlurPx } from './blur';
import { observeLabels, type ObserveContext } from './observationEngine';
import { defocusPx } from '../capture/imageFormation';
import { reportEightReaderConfig } from '../capture/presets';
import { REPORT_SIDE, sidePixelsPerModule, worstCaseIncidenceDeg } from '../report/reportSpec';

const STATION = { lengthMm: 2200, beltWidthMm: 650 };
const DEFAULTS = {
  sensorWidthPx: 5320,
  sensorHeightPx: 3032,
  focalLengthMm: 16,
  exposureUs: 75,
  fps: 20,
  shutter: 'GLOBAL' as const,
};

/**
 * LEFT rig re-aimed lower (eye y=700) so the LEFT face is at ~26°
 * incidence (≤ 35° target), focused on the label plane — a readable
 * baseline geometry.
 */
function leftRig(): AreaScanCameraConfig {
  const rig = defaultCameraRigs(STATION, DEFAULTS).find((r) => r.role === 'LEFT')!;
  const eye: [number, number, number] = [-1200, 700, 1100];
  const target: [number, number, number] = [0, 400, 1100];
  const pose = { positionMm: eye, quaternion: lookAtQuaternion(eye, target) };
  // Focus exactly on the label centre (world y = 400: face centre + v offset).
  const z = toCameraSpace([-200, 400, 800], { ...rig, pose })[2];
  return {
    ...rig,
    pose,
    acquisition: { ...rig.acquisition, focusDistanceMm: z },
  };
}

function makeParcel(over: Partial<ParcelState> = {}): ParcelState {
  return {
    parcelId: 'P-001',
    spec: {
      widthMm: 400,
      heightMm: 400,
      lengthMm: 600,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm: 1100, // centre z = 800
    phase: 'ENTERED',
    ...over,
  };
}

function leftLabel(): LabelInstance {
  return {
    labelInstanceId: 'L-0001',
    payload: 'KTY-12345678901234',
    face: 'LEFT',
    localOffsetMm: [0, 200],
    rotationDeg: 0,
    widthMm: 78,
    heightMm: 25,
    damage: 0,
  };
}

function makeCfg() {
  const cfg = defaultConfig();
  cfg.barcode.xDimensionMm = 1.1; // large modules → decodable PPM at rig distance
  return cfg;
}

const CTX: ObserveContext = { simTimeMs: 1000, speedMmPerSec: 1000 };

describe('observeLabels', () => {
  it('readable baseline: one observation per label, all components 1, passes', () => {
    const rig = leftRig();
    const parcel = makeParcel({ spec: { ...makeParcel().spec, labels: [leftLabel()] } });
    const obs = observeLabels(rig, 'IDLE', [parcel], [parcel], CTX, makeCfg());
    expect(obs).toHaveLength(1);
    const o = obs[0];
    expect(o.labelInstanceId).toBe('L-0001');
    expect(o.projectedCornersPx).toHaveLength(4);
    expect(o.coverage).toBeCloseTo(1, 6);
    expect(o.qualityPassed).toBe(true);
    expect(o.reasons).toEqual([]);
    expect(Object.values(o.qualityComponents).every((c) => c === 1)).toBe(true);
    expect(o.confidence).toBe(1);
  });

  it('PPM comes from the physical sensor model (PIPE-002)', () => {
    const rig = leftRig();
    const label = leftLabel();
    const parcel = makeParcel({ spec: { ...makeParcel().spec, labels: [label] } });
    const cfg = makeCfg();
    const o = observeLabels(rig, 'IDLE', [parcel], [parcel], CTX, cfg)[0];
    const intr = sensorIntrinsics(rig.sensor);
    const centre = [
      -parcel.spec.widthMm / 2,
      parcel.spec.heightMm / 2 + label.localOffsetMm[1],
      parcel.frontZMm - parcel.spec.lengthMm / 2,
    ] as [number, number, number];
    const z = toCameraSpace(centre, rig)[2];
    expect(o.pixelsPerModule).toBeCloseTo((intr.fx / z) * cfg.barcode.xDimensionMm, 6);
  });

  it('blur/focus match the analytic per-label values', () => {
    const rig = leftRig();
    const label = leftLabel();
    const parcel = makeParcel({ spec: { ...makeParcel().spec, labels: [label] } });
    const o = observeLabels(rig, 'IDLE', [parcel], [parcel], CTX, makeCfg())[0];
    expect(o.blurPx).toBeCloseTo(labelMotionBlurPx(rig, label, parcel, CTX.speedMmPerSec), 8);
    const z = toCameraSpace([-200, 400, 800], rig)[2];
    expect(o.qualityComponents.focus).toBeCloseTo(1, 6);
    expect(defocusPx(rig, z)).toBeLessThan(0.05);
  });

  it('is deterministic for identical inputs', () => {
    const rig = leftRig();
    const parcel = makeParcel({ spec: { ...makeParcel().spec, labels: [leftLabel()] } });
    const cfg = makeCfg();
    const a = observeLabels(rig, 'IDLE', [parcel], [parcel], CTX, cfg);
    const b = observeLabels(rig, 'IDLE', [parcel], [parcel], CTX, cfg);
    expect(a).toEqual(b);
  });

  it('camera FAULT → CAMERA_FAULT reason, hard fail', () => {
    const rig = leftRig();
    const parcel = makeParcel({ spec: { ...makeParcel().spec, labels: [leftLabel()] } });
    const o = observeLabels(rig, 'FAULT', [parcel], [parcel], CTX, makeCfg())[0];
    expect(o.reasons).toContain('CAMERA_FAULT');
    expect(o.qualityPassed).toBe(false);
    expect(o.qualityGates).toContain('CAMERA_FAULT');
  });

  it('tall parcel between the rig and the label → OCCLUDED', () => {
    const rig = leftRig();
    const A = makeParcel({ spec: { ...makeParcel().spec, labels: [leftLabel()] } });
    // 600 mm tall parcel on the ray from the LEFT rig to A's label:
    // ray (−1200,700,1100)→(−200,400,800); at x=−700 → (−700,550,950).
    const B = makeParcel({
      parcelId: 'P-002',
      frontZMm: 1025, // spans z 875..1025 (centre 950)
      spec: {
        ...makeParcel().spec,
        widthMm: 400,
        heightMm: 600,
        lengthMm: 150,
        lateralOffsetMm: -700,
        labels: [],
      },
    });
    const withB = observeLabels(rig, 'IDLE', [A], [A, B], CTX, makeCfg())[0];
    expect(withB.reasons).toContain('OCCLUDED');
    expect(withB.qualityPassed).toBe(false);
    // No occluder → no OCCLUDED reason:
    const without = observeLabels(rig, 'IDLE', [A], [A], CTX, makeCfg())[0];
    expect(without.reasons).not.toContain('OCCLUDED');
    expect(without.qualityPassed).toBe(true);
  });

  it('label behind the camera → empty corners, OUT_OF_FOV, fail', () => {
    const rig = leftRig();
    const label = leftLabel();
    // Parcel entirely behind the LEFT rig (camera looks toward +x):
    const parcel = makeParcel({
      frontZMm: 800,
      spec: {
        ...makeParcel().spec,
        lateralOffsetMm: -2200,
        labels: [label],
      },
    });
    const o = observeLabels(rig, 'IDLE', [parcel], [parcel], CTX, makeCfg())[0];
    expect(o.projectedCornersPx).toEqual([]);
    expect(o.reasons).toContain('OUT_OF_FOV');
    expect(o.qualityPassed).toBe(false);
  });

  it('faster belt raises blurPx (PIPE-003) and can flip LOW_PPM-free blur reasons', () => {
    const rig = leftRig();
    const parcel = makeParcel({ spec: { ...makeParcel().spec, labels: [leftLabel()] } });
    const cfg = makeCfg();
    const slow = observeLabels(rig, 'IDLE', [parcel], [parcel], { ...CTX, speedMmPerSec: 200 }, cfg)[0];
    const fast = observeLabels(rig, 'IDLE', [parcel], [parcel], { ...CTX, speedMmPerSec: 3000 }, cfg)[0];
    expect(fast.blurPx).toBeGreaterThan(slow.blurPx);
    // 3 m/s at 75 µs → ~0.73 px > 0.5 target:
    expect(fast.reasons).toContain('MOTION_BLUR');
    expect(slow.reasons).not.toContain('MOTION_BLUR');
  });
});

// ---------------------------------------------------------------------------
// t2-optics: report side-reader optics — pinhole projection, incidence,
// focus (camera.ts sensorIntrinsics + defocusPx through the engine).
// ---------------------------------------------------------------------------
describe('t2-optics: report layout side optics', () => {
  const preset = reportEightReaderConfig();
  const sideRigs = preset.cameraRigs.filter((r) => r.kind === 'AREA_SCAN');
  const ctx: ObserveContext = { simTimeMs: 0, speedMmPerSec: 1000 };

  function rightLabel(): LabelInstance {
    return {
      labelInstanceId: 'L-R',
      payload: 'KTY-12345678901234',
      face: 'RIGHT',
      localOffsetMm: [0, 0],
      rotationDeg: 0,
      widthMm: 78,
      heightMm: 25,
      damage: 0,
    };
  }

  it('projected ppm matches the reportSpec pinhole formula (±5%)', () => {
    const rig = sideRigs.find((r) => r.name.includes('RIGHT 90°'))!;
    const parcel = makeParcel({
      spec: { ...makeParcel().spec, labels: [rightLabel()] },
    });
    const cfg = preset;
    const obs = observeLabels(rig, 'IDLE', [parcel], [parcel], ctx, cfg)[0];
    // Face sits exactly at the 1450 mm working distance for the nominal
    // 400 mm parcel, so the spec formula applies at WD.
    const expected = sidePixelsPerModule(
      cfg.barcode.xDimensionMm,
      REPORT_SIDE.focalLengthMm,
      REPORT_SIDE.pixelPitchMm,
      REPORT_SIDE.workingDistanceMm,
      0,
    );
    // The engine projects with fx/camZ (pure pinhole at the face plane);
    // the report formula divides by (WD − focal). The two agree within
    // ~4%, inside the 5% contract tolerance.
    expect(
      Math.abs(obs.pixelsPerModule - expected) / expected,
    ).toBeLessThan(0.05);
    // Label centre is 300 mm (half parcel length) off the aim point.
    expect(obs.distanceMm).toBeCloseTo(
      Math.hypot(REPORT_SIDE.workingDistanceMm, 300),
      3,
    );
  });

  it('worst-case view-axis incidence equals the report 30°; the 30° rig reports it on a face-centre label', () => {
    // Design check: the 30°/330° rigs give the FRONT face its worst-case
    // view-axis incidence at the parcel centre.
    const frontFaceNormal: [number, number, number] = [0, 0, 1];
    const centre: [number, number, number] = [0, 200, 1100];
    const axisIncidence = sideRigs
      .map((r) => {
        const v: [number, number, number] = [
          centre[0] - r.pose.positionMm[0],
          centre[1] - r.pose.positionMm[1],
          centre[2] - r.pose.positionMm[2],
        ];
        const len = Math.hypot(...v);
        const cos = (v[0] * frontFaceNormal[0] + v[2] * frontFaceNormal[2]) / len;
        return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      })
      .sort((a, b) => a - b);
    expect(axisIncidence[0]).toBeCloseTo(
      worstCaseIncidenceDeg(REPORT_SIDE.directionSpacingDeg),
      6,
    );

    // Engine check: a face-centre label from the 30° rig never
    // under-reports the design incidence.
    const rig = sideRigs.find((r) => r.name.includes('FRONT-RIGHT 30°'))!;
    const frontLabel: LabelInstance = {
      ...rightLabel(),
      labelInstanceId: 'L-F',
      face: 'FRONT',
    };
    const parcel = makeParcel({
      spec: { ...makeParcel().spec, labels: [frontLabel] },
    });
    const obs = observeLabels(rig, 'IDLE', [parcel], [parcel], ctx, preset)[0];
    expect(obs.incidenceDeg).toBeCloseTo(
      worstCaseIncidenceDeg(REPORT_SIDE.directionSpacingDeg),
      3,
    );
  });

  it('side labels at the nominal working distance are in focus (defocus ≈ 0)', () => {
    const rig = sideRigs.find((r) => r.name.includes('RIGHT 90°'))!;
    const parcel = makeParcel({
      spec: { ...makeParcel().spec, labels: [rightLabel()] },
    });
    const obs = observeLabels(rig, 'IDLE', [parcel], [parcel], ctx, preset)[0];
    // Focused at 1450 mm, face at 1450 mm → defocus term is zero; the
    // residual blurPx is belt motion only (1 m/s × 75 µs ≈ 0.63 px).
    expect(obs.blurPx).toBeLessThan(1);
    expect(obs.reasons).not.toContain('OUT_OF_FOCUS');
  });
});

/**
 * Observation engine (PIPE-001..005): assembles LabelObservations from the
 * pure geometric modules. Fixtures use the real default rig layout.
 */

import { defaultCameraRigs, lookAtQuaternion, sensorIntrinsics, toCameraSpace } from '../domain/camera';
import { defaultConfig } from '../domain/config';
import type { CameraConfig, LabelInstance, ParcelState } from '../domain/types';
import { labelMotionBlurPx } from './blur';
import { observeLabels, type ObserveContext } from './observationEngine';
import { defocusPx } from '../capture/imageFormation';

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
function leftRig(): CameraConfig {
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

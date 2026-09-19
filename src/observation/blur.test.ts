import {
  effectiveExposureS,
  labelMotionBlurPx,
  motionBlurPx,
  motionBlurVisual,
  parcelMotionBlurPx,
  travelDirectionImageSpace,
} from './blur';
import { defaultCameraRigs, sensorIntrinsics, toCameraSpace } from '../domain/camera';
import type { CameraConfig, ParcelState } from '../domain/types';
import { labelCornersWorldMm } from './projection';

const STATION = { lengthMm: 2200, beltWidthMm: 650 };
const CAMS = {
  sensorWidthPx: 5320,
  sensorHeightPx: 3032,
  focalLengthMm: 16,
  exposureUs: 75,
  fps: 20,
  shutter: 'GLOBAL' as const,
};
const rigs = () => defaultCameraRigs(STATION, CAMS);

function parcel(frontZMm: number, lateralOffsetMm = 0): ParcelState {
  return {
    parcelId: 'P1',
    spec: {
      widthMm: 400,
      heightMm: 400,
      lengthMm: 600,
      lateralOffsetMm,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm,
    phase: 'ENTERED',
  };
}

describe('motionBlurPx (IMG-001)', () => {
  it('applies the pinhole formula blurPx = fx·v·t/z', () => {
    const px = motionBlurPx({
      distanceMm: 1800,
      speedMmPerSec: 1000,
      exposureS: 75e-6,
      focalPx: 3622,
    });
    expect(px).toBeCloseTo((3622 * 1000 * 75e-6) / 1800, 6);
  });

  it('shrinks with distance and speed, is zero for idle/behind', () => {
    const base = motionBlurPx({
      distanceMm: 1800, speedMmPerSec: 1000, exposureS: 75e-6, focalPx: 3622,
    });
    expect(motionBlurPx({
      distanceMm: 900, speedMmPerSec: 1000, exposureS: 75e-6, focalPx: 3622,
    })).toBeCloseTo(base * 2, 6);
    expect(motionBlurPx({
      distanceMm: 1800, speedMmPerSec: 0, exposureS: 75e-6, focalPx: 3622,
    })).toBe(0);
    expect(motionBlurPx({
      distanceMm: -10, speedMmPerSec: 1000, exposureS: 75e-6, focalPx: 3622,
    })).toBe(0);
  });

  it('grows with exposure time (longer shutter → more blur)', () => {
    const a = motionBlurPx({ distanceMm: 500, speedMmPerSec: 1000, exposureS: 75e-6, focalPx: 3622 });
    const b = motionBlurPx({ distanceMm: 500, speedMmPerSec: 1000, exposureS: 300e-6, focalPx: 3622 });
    expect(b / a).toBeCloseTo(4, 6);
  });
});

describe('effectiveExposureS (IMG-004)', () => {
  it('global shutter: exposure only', () => {
    const rig = rigs()[0];
    expect(effectiveExposureS(rig)).toBeCloseTo(75e-6, 12);
  });

  it('rolling shutter: exposure + row readout', () => {
    const rig: CameraConfig = { ...rigs()[0], acquisition: { ...rigs()[0].acquisition, shutter: 'ROLLING', rollingReadoutUs: 30000 } };
    expect(effectiveExposureS(rig)).toBeCloseTo(75e-6 + 30000e-6, 12);
  });
});

describe('parcelMotionBlurPx', () => {
  const TOP = () => rigs()[4];
  const LEFT = () => rigs()[2];
  it('reports blur for a parcel in front, 0 behind the camera', () => {
    const inFront = parcelMotionBlurPx(TOP(), parcel(1100), 1000);
    expect(inFront).toBeGreaterThan(0);
    // Parcel centre 800 mm behind the LEFT reader's plane → cam_z < 0.
    expect(parcelMotionBlurPx(LEFT(), parcel(1100, -2000), 1000)).toBe(0);
  });

  it('matches the hand-computed value for the TOP reader', () => {
    // TOP: distance 1800 mm, fx = 16mm / (23.5/5320 mm/px)
    const fx = sensorIntrinsics(TOP().sensor).fx;
    const expected = (fx * 1000 * 75e-6) / 1800;
    expect(parcelMotionBlurPx(TOP(), parcel(1100), 1000)).toBeCloseTo(expected, 6);
  });
});

describe('travelDirectionImageSpace (IMG-002)', () => {
  it('TOP reader sees travel along the image x-axis', () => {
    const d = travelDirectionImageSpace(rigs()[4]);
    expect(Math.abs(d[0])).toBeCloseTo(1, 6);
    expect(d[1]).toBeCloseTo(0, 6);
  });

  it('LEFT reader sees travel along the image x-axis', () => {
    const d = travelDirectionImageSpace(rigs()[2]);
    expect(Math.abs(d[0])).toBeCloseTo(1, 6);
    expect(d[1]).toBeCloseTo(0, 6);
  });

  it('FRONT reader sees travel mostly vertical (receding down-frame)', () => {
    const d = travelDirectionImageSpace(rigs()[0]);
    expect(Math.abs(d[1])).toBeGreaterThan(0.6);
  });
});

describe('motionBlurVisual (IMG-002, IMG-003)', () => {
  const TOP = () => rigs()[4];
  const P = () => parcel(1100); // centre z=1100, 1800 mm below the TOP reader

  it('OFF mode emits nothing', () => {
    const rig: CameraConfig = { ...TOP(), imageEffects: { ...TOP().imageEffects, motionBlur: 'OFF' } };
    const v = motionBlurVisual(rig, P(), 1000, 6);
    expect(v).toEqual({ mode: 'OFF', direction: [0, 0], lengthPx: 0, samples: 1, rollingSkew: 0 });
  });

  it('DIRECTIONAL: fixed 8 taps, length = analytic value', () => {
    const v = motionBlurVisual(TOP(), P(), 1000, 1);
    expect(v.mode).toBe('DIRECTIONAL');
    expect(v.samples).toBe(8);
    const fx = sensorIntrinsics(TOP().sensor).fx;
    expect(v.lengthPx).toBeCloseTo((fx * 1000 * 75e-6) / 1800, 6);
    expect(v.rollingSkew).toBe(0);
  });

  it('TEMPORAL_ACCUMULATION uses the rig sample count', () => {
    const rig: CameraConfig = { ...TOP(), imageEffects: { ...TOP().imageEffects, motionBlur: 'TEMPORAL_ACCUMULATION', temporalSamples: 5 } };
    const v = motionBlurVisual(rig, P(), 1000, 1);
    expect(v.samples).toBe(5);
  });

  it('amplification scales the VISUAL length only (IMG-003)', () => {
    const base = motionBlurVisual(TOP(), P(), 1000, 1);
    const amp = motionBlurVisual(TOP(), P(), 1000, 8);
    expect(amp.lengthPx).toBeCloseTo(base.lengthPx * 8, 6);
    // Analytic value untouched:
    expect(parcelMotionBlurPx(TOP(), P(), 1000)).toBeCloseTo(base.lengthPx, 6);
  });

  it('rolling shutter adds a positive readout wedge (IMG-004)', () => {
    const rig: CameraConfig = {
      ...TOP(),
      acquisition: { ...TOP().acquisition, shutter: 'ROLLING', rollingReadoutUs: 30000 },
    };
    const v = motionBlurVisual(rig, P(), 1000, 1);
    expect(v.rollingSkew).toBeGreaterThan(0);
    const fx = sensorIntrinsics(rig.sensor).fx;
    const skewPx = (fx * 1000 * 30000e-6) / 1800;
    expect(v.rollingSkew).toBeCloseTo(skewPx / rig.sensor.heightPx, 6);
    // Analytic blur now includes the readout window:
    expect(parcelMotionBlurPx(rig, P(), 1000)).toBeCloseTo(
      (fx * 1000 * 30075e-6) / 1800, 6,
    );
  });
});

describe('labelMotionBlurPx (PIPE-003, §8.1 corner-based)', () => {
  const F = () => rigs()[0]; // FRONT rig: eye [0,1200,-900] → [0,0,600]
  const L = () => rigs()[2]; // LEFT rig: eye [-1200,900,1100] → [0,0,1100]
  // Parcel spans z 500..1100 (centre 800).
  const P = () => parcel(1100);

  function rearLabel(): import('../domain/types').LabelInstance {
    return {
      labelInstanceId: 'L-1',
      payload: 'KTY-00000000000000',
      face: 'REAR',
      localOffsetMm: [0, 200],
      rotationDeg: 0,
      widthMm: 300,
      heightMm: 80,
      damage: 0,
    };
  }
  function leftLabel(): import('../domain/types').LabelInstance {
    return {
      labelInstanceId: 'L-2',
      payload: 'KTY-11111111111111',
      face: 'LEFT',
      localOffsetMm: [0, 200],
      rotationDeg: 0,
      widthMm: 300, // along z
      heightMm: 80,
      damage: 0,
    };
  }

  it('zero speed (or zero exposure) gives zero blur', () => {
    expect(labelMotionBlurPx(F(), rearLabel(), P(), 0)).toBe(0);
    const noExp = { ...F(), acquisition: { ...F().acquisition, exposureUs: 0 } };
    expect(labelMotionBlurPx(noExp, rearLabel(), P(), 1000)).toBe(0);
  });

  /** Independent reference: per-corner image displacement, shutter open→closed. */
  function cornerDisps(
    r: CameraConfig,
    label: import('../domain/types').LabelInstance,
    p: ParcelState,
    speed: number,
  ): number[] {
    const t = effectiveExposureS(r);
    const closed = { ...p, frontZMm: p.frontZMm + speed * t };
    const intr = sensorIntrinsics(r.sensor);
    const a = labelCornersWorldMm(label, p);
    const b = labelCornersWorldMm(label, closed);
    return a.map((pa, i) => {
      const ca = toCameraSpace(pa, r);
      const cb = toCameraSpace(b[i], r);
      if (ca[2] <= 0 || cb[2] <= 0) return 0;
      const x0 = intr.fx * (ca[0] / ca[2]) + intr.cx;
      const y0 = intr.cy - intr.fy * (ca[1] / ca[2]);
      const x1 = intr.fx * (cb[0] / cb[2]) + intr.cx;
      const y1 = intr.cy - intr.fy * (cb[1] / cb[2]);
      return Math.hypot(x1 - x0, y1 - y0);
    });
  }

  it('equals the MAX of the four corner displacements (§8.1)', () => {
    const got = labelMotionBlurPx(F(), rearLabel(), P(), 1000);
    const max = Math.max(...cornerDisps(F(), rearLabel(), P(), 1000));
    expect(got).toBeCloseTo(max, 8);
  });

  it('oblique rig: motion along the view axis yields LESS image displacement than fx·v·t/z', () => {
    const fx = sensorIntrinsics(F().sensor).fx;
    const cam = toCameraSpace([0, 200, 500], F());
    const naive = (fx * 1000 * 75e-6) / cam[2]; // assumes v ⊥ view axis
    const got = labelMotionBlurPx(F(), rearLabel(), P(), 1000);
    // FRONT rig views travel at ~53°: only the ⊥ component (≈0.62·v) sweeps the image.
    expect(got).toBeLessThan(naive);
    expect(got).toBeGreaterThan(naive * 0.3);
  });

  it('side rig (view ⊥ travel): exact pinhole fx·v·t/z at the nearest corner', () => {
    const fx = sensorIntrinsics(L().sensor).fx;
    const got = labelMotionBlurPx(L(), leftLabel(), P(), 1000);
    const disps = cornerDisps(L(), leftLabel(), P(), 1000);
    expect(Math.max(...disps)).toBeCloseTo(got, 8);
    // Motion is purely across the image plane → exact pinhole at the nearest corner:
    const corners = labelCornersWorldMm(leftLabel(), P());
    const nearest = Math.min(...corners.map((c) => toCameraSpace(c, L())[2]));
    expect(got).toBeCloseTo((fx * 1000 * 75e-6) / nearest, 6);
  });

  it('rolling shutter extends the integration window (IMG-004)', () => {
    const global = labelMotionBlurPx(F(), rearLabel(), P(), 1000);
    const rolling = {
      ...F(),
      acquisition: { ...F().acquisition, shutter: 'ROLLING' as const, rollingReadoutUs: 30000 },
    };
    // Effective window 75 µs + 30 ms readout = 401× the global window.
    const rolled = labelMotionBlurPx(rolling, rearLabel(), P(), 1000);
    expect(rolled).toBeGreaterThan(global);
    expect(rolled).toBeGreaterThan(global * 401 * 0.98);
    expect(rolled).toBeLessThan(global * 401 * 1.02);
  });

  it('all corners behind the camera → 0 (out of FOV)', () => {
    // Parcel entirely behind the FRONT rig (camera looks toward +z).
    const behind = parcel(-1500);
    expect(labelMotionBlurPx(F(), rearLabel(), behind, 1000)).toBe(0);
  });
});

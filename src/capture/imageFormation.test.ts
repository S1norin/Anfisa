/**
 * Image formation + artifacts (IMG-005..IMG-012, analytic side).
 *
 * Pins the pure functions in `imageFormation.ts`: exposure model, defocus,
 * glare/polarization, flicker, noise seed, and the assembled frame values —
 * including the IMG-003 rule (amplification/toggles touch VISUAL output
 * only) and the IMG-012 CLEAN collapse.
 */

import {
  defaultCameraRigs,
  defaultEffectToggles,
} from '../domain/camera';
import type { CameraConfig, ParcelState } from '../domain/types';
import {
  defocusPx,
  defocusPxWithFocal,
  effectiveExposureWindowS,
  exposureMetrics,
  flickerFactor,
  frameArtifacts,
  frameGlareIndex,
  hashFrameSeed,
  parcelGlareIndex,
  rigOpticalFocalMm,
} from './imageFormation';

const STATION = { lengthMm: 3000, beltWidthMm: 600 };

const DEFAULTS = {
  sensorWidthPx: 2448,
  sensorHeightPx: 2048,
  focalLengthMm: 16,
  exposureUs: 75,
  fps: 30,
  shutter: 'GLOBAL' as const,
};

/** Deep partial that preserves tuples/scalars (pose vectors, distortion). */
type DeepPartial<T> = T extends [number, ...number[]]
  ? T
  : T extends string | number | boolean
    ? T
    : { [K in keyof T]?: DeepPartial<T[K]> };

function mergeRig(base: CameraConfig, over: DeepPartial<CameraConfig>): CameraConfig {
  return {
    ...base,
    ...over,
    pose: { ...base.pose, ...over.pose },
    sensor: {
      ...base.sensor,
      ...over.sensor,
      roi: over.sensor?.roi
        ? { ...(base.sensor.roi ?? { x: 0, y: 0, width: 0, height: 0 }), ...over.sensor.roi }
        : base.sensor.roi,
    },
    acquisition: { ...base.acquisition, ...over.acquisition },
    illumination: { ...base.illumination, ...over.illumination },
    optics: { ...base.optics, ...over.optics },
    imageEffects: {
      ...base.imageEffects,
      ...over.imageEffects,
      toggles: { ...defaultEffectToggles(), ...over.imageEffects?.toggles },
    },
    preview: { ...base.preview, ...over.preview },
  };
}

const FRONT = defaultCameraRigs(STATION, DEFAULTS)[0];
const BOTTOM = defaultCameraRigs(STATION, DEFAULTS).find((r) => r.role === 'BOTTOM')!;

function makeFrontRig(over: DeepPartial<CameraConfig> = {}): CameraConfig {
  return mergeRig(FRONT, over);
}

/** BOTTOM reader — sits inside the specular lobe of the top lights. */
function makeBottomRig(over: DeepPartial<CameraConfig> = {}): CameraConfig {
  return mergeRig(BOTTOM, over);
}

function parcelAt(
  frontZMm: number,
  over: Partial<ParcelState['spec']> = {},
): ParcelState {
  return {
    parcelId: 'P-001',
    spec: {
      widthMm: 300,
      heightMm: 120,
      lengthMm: 250,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [],
      ...over,
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm,
    phase: 'SPAWNED',
  };
}

/** Parcel centred on the station middle (z = 1500). */
const MID = 1500 + 250 / 2;

describe('exposureMetrics (IMG-005)', () => {
  it('is neutral at nominal exposure, gain and intensity', () => {
    const m = exposureMetrics(makeFrontRig());
    expect(m.brightness).toBeCloseTo(1, 9);
    expect(m.clipFraction).toBe(0);
    expect(m.underexposureFraction).toBe(0);
    expect(m.overexposed).toBe(false);
    expect(m.underexposed).toBe(false);
  });

  it('clips highlights above the knee, saturating at 4x', () => {
    const rig = makeFrontRig({ acquisition: { ...makeFrontRig().acquisition, exposureUs: 300 } });
    const m = exposureMetrics(rig);
    expect(m.brightness).toBeCloseTo(4, 9);
    expect(m.clipFraction).toBe(1);
    expect(m.overexposed).toBe(true);
    // Mild overexposure is proportional.
    const mild = makeFrontRig({ acquisition: { ...makeFrontRig().acquisition, exposureUs: 150 } });
    expect(exposureMetrics(mild).clipFraction).toBeCloseTo((2 - 1.25) / 2.75, 9);
  });

  it('reports underexposure below 0.5, fully at 0', () => {
    const rig = makeFrontRig({ acquisition: { ...makeFrontRig().acquisition, exposureUs: 7.5 } });
    const m = exposureMetrics(rig);
    expect(m.brightness).toBeCloseTo(0.1, 9);
    expect(m.underexposureFraction).toBeCloseTo(0.8, 9);
    expect(m.underexposed).toBe(true);
    const dark = makeFrontRig({ acquisition: { ...makeFrontRig().acquisition, exposureUs: 0.00000075 } });
    expect(exposureMetrics(dark).underexposureFraction).toBeCloseTo(1, 6);
  });

  it('scales with gain (2^(dB/10)) and illumination', () => {
    const g = makeFrontRig({ acquisition: { ...makeFrontRig().acquisition, gainDb: 10 } });
    expect(exposureMetrics(g).gainFactor).toBeCloseTo(2, 9);
    const dim = makeFrontRig({ illumination: { ...makeFrontRig().illumination, intensity: 0.5 } });
    expect(exposureMetrics(dim).brightness).toBeCloseTo(0.5, 9);
  });

  it('applies the flicker illuminationFactor multiplicatively', () => {
    const rig = makeFrontRig();
    const m = exposureMetrics(rig, 0.4);
    expect(m.brightness).toBeCloseTo(0.4, 9);
  });
});

describe('defocus (IMG-007)', () => {
  const FOCAL = 16;

  it('is zero exactly at the focus distance', () => {
    expect(defocusPxWithFocal(makeFrontRig(), 1000, FOCAL)).toBe(0);
  });

  it('is zero for objects closer than the focal length (no image)', () => {
    expect(defocusPxWithFocal(makeFrontRig(), 10, FOCAL)).toBe(0);
  });

  it('grows monotonically as the object moves away from focus', () => {
    const a = defocusPxWithFocal(makeFrontRig(), 800, FOCAL);
    const b = defocusPxWithFocal(makeFrontRig(), 600, FOCAL);
    const c = defocusPxWithFocal(makeFrontRig(), 400, FOCAL);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('grows with aperture size (bigger pupil, bigger CoC)', () => {
    const narrow = makeFrontRig({ optics: { ...makeFrontRig().optics, apertureProxy: 4 } });
    const wide = makeFrontRig({ optics: { ...makeFrontRig().optics, apertureProxy: 1.4 } });
    const d = 800;
    expect(defocusPxWithFocal(wide, d, FOCAL)).toBeGreaterThan(
      defocusPxWithFocal(narrow, d, FOCAL),
    );
  });

  it('rigOpticalFocalMm recovers the configured focal length', () => {
    const rig = makeFrontRig();
    expect(rigOpticalFocalMm(rig)).toBeCloseTo(rig.sensor.focalLengthMm, 6);
    // The rig-level convenience matches the explicit-focal variant.
    const d = 900;
    expect(defocusPx(rig, d)).toBeCloseTo(defocusPxWithFocal(rig, d, rigOpticalFocalMm(rig)), 9);
  });
});

describe('glare + polarization (IMG-008)', () => {
  it('is 0 for untaped parcels', () => {
    expect(parcelGlareIndex(makeFrontRig(), parcelAt(MID))).toBe(0);
  });

  it('is 0 when the camera is outside the specular lobe', () => {
    // TOP reader looks straight down; the lobe of a top light pointing
    // down reflects away from it.
    const rigs = defaultCameraRigs(STATION, {
      sensorWidthPx: 2448,
      sensorHeightPx: 2048,
      focalLengthMm: 16,
      exposureUs: 75,
      fps: 30,
      shutter: 'GLOBAL',
    });
    const top = rigs.find((r) => r.role === 'TOP')!;
    expect(parcelGlareIndex(top, parcelAt(MID, { tape: true }))).toBe(0);
  });

  it('peaks when the camera sits in the specular lobe, halved by polarized light', () => {
    const bottom = makeBottomRig();
    const p = parcelAt(MID, { tape: true });
    const pol = parcelGlareIndex(bottom, p);
    expect(pol).toBeGreaterThan(0.4);
    const unpol = parcelGlareIndex(
      makeBottomRig({ illumination: { polarized: false } }),
      p,
    );
    expect(unpol).toBeCloseTo(pol * 2, 6);
  });

  it('falls off for off-axis observers', () => {
    const on = parcelGlareIndex(makeBottomRig(), parcelAt(MID, { tape: true }));
    const off = parcelGlareIndex(
      makeBottomRig({ pose: { positionMm: [400, -400, 1500] } }),
      parcelAt(MID, { tape: true }),
    );
    expect(off).toBeLessThan(on);
  });

  it('frameGlareIndex takes the max over candidates', () => {
    const bottom = makeBottomRig();
    const taped = parcelAt(MID, { tape: true });
    const plain = parcelAt(MID, { tape: false });
    expect(frameGlareIndex(bottom, [plain, taped])).toBe(
      parcelGlareIndex(bottom, taped),
    );
  });
});

describe('flickerFactor (IMG-009)', () => {
  it('is 1 with no flicker configured', () => {
    expect(flickerFactor(1234, 0, 0.5)).toBe(1);
    expect(flickerFactor(1234, 100, 0)).toBe(1);
  });

  it('oscillates between 1 - depth and 1, deterministically', () => {
    const peak = flickerFactor(2.5, 100, 0.5); // sin(2π·100·2.5/1000) = 1
    expect(peak).toBeCloseTo(0.5, 9);
    expect(flickerFactor(0, 100, 0.5)).toBeCloseTo(0.75, 9); // sin(0) = 0
    expect(flickerFactor(7.5, 100, 0.5)).toBe(1); // sin(1.5π) = -1
    let min = 1;
    let max = 0;
    for (let t = 0; t < 10; t += 0.25) {
      const f = flickerFactor(t, 100, 0.5);
      min = Math.min(min, f);
      max = Math.max(max, f);
    }
    expect(min).toBeCloseTo(0.5, 6);
    expect(max).toBe(1);
  });

  it('determines exposure through illuminationFactor', () => {
    const rig = makeFrontRig();
    const steady = exposureMetrics(rig, 1).brightness;
    const dip = exposureMetrics(rig, flickerFactor(2.5, 100, 0.5)).brightness;
    expect(dip).toBeCloseTo(steady * 0.5, 9);
  });
});

describe('hashFrameSeed (IMG-006 determinism)', () => {
  it('is stable and distinct per frame id', () => {
    expect(hashFrameSeed('f-CAM-001-1000')).toBe(hashFrameSeed('f-CAM-001-1000'));
    expect(hashFrameSeed('f-CAM-001-1000')).not.toBe(hashFrameSeed('f-CAM-001-1001'));
  });
});

describe('frameArtifacts (assembled frame, IMG-001..IMG-012)', () => {
  const SPEED = 500;

  it('empty frame: no parcel artifacts, exposure/noise still apply', () => {
    const a = frameArtifacts(makeFrontRig(), [], SPEED, 'f-1').analytic;
    expect(a.motionBlurPx).toBe(0);
    expect(a.defocusPx).toBe(0);
    expect(a.glareIndex).toBe(0);
    expect(a.damageMax).toBe(0);
    const v = frameArtifacts(makeFrontRig(), [], SPEED, 'f-1').visual;
    expect(v.motionPx).toBe(0);
    expect(v.brightness).toBeGreaterThan(0);
  });

  it('measures motion blur and reports rolling skew only for rolling shutters', () => {
    const global = makeFrontRig();
    const rolling = makeFrontRig({
      acquisition: { ...global.acquisition, shutter: 'ROLLING' },
    });
    const p = parcelAt(MID);
    expect(frameArtifacts(global, [p], SPEED, 'f').analytic.rollingSkewFraction).toBe(0);
    expect(frameArtifacts(rolling, [p], SPEED, 'f').analytic.rollingSkewFraction).toBeGreaterThan(0);
    expect(frameArtifacts(global, [p], SPEED, 'f').analytic.motionBlurPx).toBeGreaterThan(0);
    // Rolling integrates exposure + readout → more blur.
    expect(
      frameArtifacts(rolling, [p], SPEED, 'f').analytic.motionBlurPx,
    ).toBeGreaterThan(frameArtifacts(global, [p], SPEED, 'f').analytic.motionBlurPx);
    expect(effectiveExposureWindowS(rolling)).toBeCloseTo(
      75e-6 + 30000e-6,
      9,
    );
  });

  it('IMG-003: amplification scales VISUAL values only, never analytic', () => {
    const base = makeBottomRig();
    const amp = makeBottomRig({ imageEffects: { artifactAmplification: 4 } });
    const p = parcelAt(MID, { tape: true });
    const phys = frameArtifacts(base, [p], SPEED, 'f', 'PHYSICAL');
    const ampl = frameArtifacts(amp, [p], SPEED, 'f', 'AMPLIFIED');
    // Analytic: byte-identical.
    expect(ampl.analytic.motionBlurPx).toBe(phys.analytic.motionBlurPx);
    expect(ampl.analytic.defocusPx).toBe(phys.analytic.defocusPx);
    expect(ampl.analytic.glareIndex).toBe(phys.analytic.glareIndex);
    // Visual: scaled by 4.
    expect(ampl.visual.motionPx).toBeCloseTo(phys.visual.motionPx * 4, 9);
    expect(ampl.visual.defocusPx).toBeCloseTo(phys.visual.defocusPx * 4, 9);
    expect(ampl.visual.glare).toBeCloseTo(phys.visual.glare * 4, 9);
  });

  it('CLEAN collapses every visual effect to neutral while analytic is untouched', () => {
    const base = makeBottomRig();
    const p = parcelAt(MID, { tape: true });
    const clean = frameArtifacts(base, [p], SPEED, 'f', 'CLEAN');
    expect(clean.visual.motionPx).toBe(0);
    expect(clean.visual.motionSamples).toBe(1);
    expect(clean.visual.rollingSkew).toBe(0);
    expect(clean.visual.defocusPx).toBe(0);
    expect(clean.visual.brightness).toBe(1);
    expect(clean.visual.clipFraction).toBe(0);
    expect(clean.visual.noiseAmp).toBe(0);
    expect(clean.visual.compression).toBe(0);
    expect(clean.visual.glare).toBe(0);
    expect(clean.visual.vignette).toBe(0);
    expect(clean.visual.distortion).toBe(0);
    // ...but the analytic measurement survives.
    expect(clean.analytic.motionBlurPx).toBeGreaterThan(0);
    expect(clean.analytic.glareIndex).toBeGreaterThan(0);
  });

  it('toggles gate individual visual effects without touching analytics (IMG-012)', () => {
    const base = makeBottomRig();
    const p = parcelAt(MID, { tape: true });
    const a = frameArtifacts(
      makeBottomRig({
        imageEffects: {
          toggles: {
            ...defaultEffectToggles(),
            motionBlur: false,
            noise: false,
            exposure: false,
            focus: false,
            glare: false,
          },
        },
      }),
      [p],
      SPEED,
      'f',
    );
    expect(a.visual.motionPx).toBe(0);
    expect(a.visual.noiseAmp).toBe(0);
    expect(a.visual.brightness).toBe(1);
    expect(a.visual.defocusPx).toBe(0);
    expect(a.visual.glare).toBe(0);
    // Analytic values are the full measurement regardless.
    expect(a.analytic.motionBlurPx).toBeGreaterThan(0);
    expect(a.analytic.glareIndex).toBeGreaterThan(0);
    expect(a.analytic.shotNoise).toBe(base.imageEffects.shotNoise);
  });

  it('noise seed is deterministic per frame id', () => {
    const base = makeFrontRig();
    const s1 = frameArtifacts(base, [], SPEED, 'f-1').visual.noiseSeed;
    const s2 = frameArtifacts(base, [], SPEED, 'f-1').visual.noiseSeed;
    const s3 = frameArtifacts(base, [], SPEED, 'f-2').visual.noiseSeed;
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
  });

  it('propagates max label damage to the analytic side', () => {
    const base = makeFrontRig();
    const p = parcelAt(MID, {
      labels: [
        {
          labelInstanceId: 'L1',
          payload: 'KTY-1',
          face: 'FRONT',
          localOffsetMm: [0, 0],
          rotationDeg: 0,
          widthMm: 78,
          heightMm: 25,
          damage: 0.4,
        },
        {
          labelInstanceId: 'L2',
          payload: 'KTY-2',
          face: 'TOP',
          localOffsetMm: [0, 0],
          rotationDeg: 0,
          widthMm: 78,
          heightMm: 25,
          damage: 0.1,
        },
      ],
    });
    expect(frameArtifacts(base, [p], SPEED, 'f').analytic.damageMax).toBe(0.4);
  });
});

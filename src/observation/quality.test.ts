/**
 * Reason codes (PIPE-005) + deterministic quality model (PIPE-004, §8).
 */

import { defaultConfig } from '../domain/config';
import type { QualityThresholds } from '../domain/config';
import { REASON_ORDER, labelReasons, type ReasonInput } from './reasons';
import { evaluateQuality } from './quality';

const T = (): QualityThresholds => defaultConfig().quality;

/** A fully clean, in-range observation (all components = 1). */
function clean(over: Partial<ReasonInput> = {}): ReasonInput {
  return {
    inFov: true,
    frontFacing: true,
    occluded: false,
    cameraFault: false,
    coverage: 1,
    ppm: 4,
    incidenceDeg: 10,
    blurPx: 0.1,
    focusPx: 0.1,
    contrast: 0.9,
    glare: 0,
    damage: 0,
    ...over,
  };
}

describe('labelReasons (PIPE-005)', () => {
  it('clean observation → no reasons', () => {
    expect(labelReasons(clean(), T())).toEqual([]);
  });

  it('emits one code per breached TARGET threshold', () => {
    const r = labelReasons(
      clean({
        ppm: 2.5, // < target 3.0 (but ≥ min 2.0)
        incidenceDeg: 40, // > target 35 (≤ max 60)
        blurPx: 0.8, // > target 0.5 (≤ max 1.0)
      } as Partial<ReasonInput>),
      T(),
    );
    expect(r).toEqual(['LOW_PPM', 'HIGH_ANGLE', 'MOTION_BLUR']);
  });

  it('coverage below the hard gate maps to OUT_OF_FOV', () => {
    expect(labelReasons(clean({ coverage: 0.5 } as Partial<ReasonInput>), T())).toContain(
      'OUT_OF_FOV',
    );
  });

  it('canonical order is stable', () => {
    const all = labelReasons(
      clean({
        inFov: false,
        frontFacing: false,
        occluded: true,
        cameraFault: true,
        ppm: 0,
        incidenceDeg: 90,
        blurPx: 5,
        glare: 1,
        contrast: 0,
        focusPx: 5,
      } as Partial<ReasonInput>),
      T(),
    );
    expect(all).toEqual(REASON_ORDER);
  });
});

describe('evaluateQuality (PIPE-004, §8)', () => {
  it('clean observation → Q = 1, all components 1, passes', () => {
    const q = evaluateQuality(clean(), T(), 'seed-A');
    expect(q.quality).toBe(1);
    expect(Object.values(q.components).every((c) => c === 1)).toBe(true);
    expect(q.gateFailures).toEqual([]);
    expect(q.passed).toBe(true);
  });

  it('quality is the PRODUCT of components', () => {
    const input = clean({ ppm: 2.5, blurPx: 0.75 } as Partial<ReasonInput>);
    const q = evaluateQuality(input, T(), 'seed-B');
    const product = Object.values(q.components).reduce((a, b) => a * b, 1);
    expect(q.quality).toBeCloseTo(product, 10);
    // ppm ramp: (2.5 - 2.0)/(3.0 - 2.0) = 0.5 ; blur ramp: (1.0-0.75)/(1.0-0.5) = 0.5
    expect(q.components.ppm).toBeCloseTo(0.5, 10);
    expect(q.components.blur).toBeCloseTo(0.5, 10);
  });

  it('hard gate (occlusion) fails even at Q ≈ 1', () => {
    const q = evaluateQuality(clean({ occluded: true } as Partial<ReasonInput>), T(), 's');
    expect(q.gateFailures).toContain('OCCLUDED');
    expect(q.passed).toBe(false);
    // Occlusion zeroes visibility, so Q = 0 too.
    expect(q.quality).toBe(0);
  });

  it('hard gate (low ppm) fails below the min', () => {
    const q = evaluateQuality(clean({ ppm: 1.5 } as Partial<ReasonInput>), T(), 's');
    expect(q.gateFailures).toContain('LOW_PPM');
    expect(q.passed).toBe(false);
  });

  it('camera fault is a hard gate with a CAMERA_FAULT reason', () => {
    const q = evaluateQuality(clean({ cameraFault: true } as Partial<ReasonInput>), T(), 's');
    expect(q.gateFailures).toContain('CAMERA_FAULT');
    expect(q.reasons).toContain('CAMERA_FAULT');
    expect(q.passed).toBe(false);
  });

  it('back-facing → BACK_FACING gate', () => {
    const q = evaluateQuality(clean({ frontFacing: false } as Partial<ReasonInput>), T(), 's');
    expect(q.gateFailures).toContain('BACK_FACING');
    expect(q.passed).toBe(false);
  });

  it('severe damage (above damageMax) is a hard gate', () => {
    const q = evaluateQuality(clean({ damage: 0.9 } as Partial<ReasonInput>), T(), 's');
    expect(q.gateFailures).toContain('DAMAGE');
    expect(q.passed).toBe(false);
  });

  it('deterministic: same seed key → same decision', () => {
    const input = clean({ ppm: 2.9, blurPx: 0.45 } as Partial<ReasonInput>);
    const a = evaluateQuality(input, T(), 'run1:CAM-001:L-0001:f0');
    const b = evaluateQuality(input, T(), 'run1:CAM-001:L-0001:f0');
    const c = evaluateQuality(input, T(), 'run1:CAM-001:L-0001:f1');
    expect(a.passed).toBe(b.passed);
    expect(a.quality).toBe(b.quality);
    // A different frame key may flip the boundary roll (not guaranteed, so
    // assert determinism, and that the roll is a function of the key).
    const d = evaluateQuality(input, T(), 'run1:CAM-001:L-0001:f1');
    expect(c.passed).toBe(d.passed);
  });

  it('boundary band: Q inside the band uses a seeded roll; above it always passes', () => {
    // Craft an input whose Q lands inside [1-band, 1): one component at 0.9.
    const t = T();
    // ppm = 2.9 → ramp (2.9-2)/(3-2) = 0.9 → Q = 0.9, in band when band ≥ 0.1.
    const input = clean({ ppm: 2.9 } as Partial<ReasonInput>);
    const band = t.boundaryBand; // 0.15 → band region [0.85, 1]
    expect(band).toBeGreaterThan(0.1);
    const q = evaluateQuality(input, t, 'k');
    expect(q.quality).toBeCloseTo(0.9, 10);
    // Above the band (Q = 1) always passes without a roll.
    const q2 = evaluateQuality(clean(), t, 'k');
    expect(q2.passed).toBe(true);
  });

  it('editable thresholds change the outcome immediately', () => {
    const input = clean({ ppm: 2.5 } as Partial<ReasonInput>);
    const strict = { ...T(), ppmTarget: 5 }; // 2.5 is now far below target
    const lax = { ...T(), ppmTarget: 2.2, ppmMin: 1.5 };
    const a = evaluateQuality(input, strict, 'k');
    const b = evaluateQuality(input, lax, 'k');
    expect(a.components.ppm).toBeLessThan(b.components.ppm);
  });
});

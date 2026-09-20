/**
 * Line-scan geometry & sampling helpers (plan Part 2, t3).
 * Concrete vectors from the preset assumptions: 8192 px over 512 mm
 * (0.0625 mm/pixel), 0.1 mm/line encoder step, 0.4 mm modules.
 */

import { describe, expect, it } from 'vitest';
import {
  completedLineCount,
  crossBeltPpm,
  edgeCrossedPlane,
  effectivePpm,
  expectedLineCount,
  parcelPlaneCrossings,
  pixelPitchMm,
  requiredLineRate,
  travelPpm,
} from './lineScanGeometry';

describe('required line rate', () => {
  it('velocity / encoder step', () => {
    expect(requiredLineRate(1500, 0.1)).toBe(15000);
    expect(requiredLineRate(1000, 0.1)).toBe(10000);
  });
});

describe('line counts', () => {
  it('expected lines = travel / step (fractional allowed)', () => {
    expect(expectedLineCount(500, 0.1)).toBe(5000);
    expect(expectedLineCount(500.05, 0.1)).toBeCloseTo(5000.5);
  });

  it('completed strip floors the line count', () => {
    expect(completedLineCount(500, 0.1)).toBe(5000);
    expect(completedLineCount(500.5, 0.1)).toBe(5005);
  });
});

describe('ppm sampling', () => {
  it('pixel pitch = sensor width / pixels per line', () => {
    expect(pixelPitchMm(8192, 512)).toBeCloseTo(0.0625);
  });

  it('cross-belt ppm = module width / pixel pitch', () => {
    // 400 mm xDim, 8192 px over 512 mm -> 6400 ppm.
    expect(crossBeltPpm(400, 8192, 512)).toBeCloseTo(6400);
    // 0.4 mm module: 0.4 / 0.0625 = 6.4.
    expect(crossBeltPpm(0.4, 8192, 512)).toBeCloseTo(6.4);
  });

  it('travel ppm = module width / encoder step (lines per module)', () => {
    expect(travelPpm(0.4, 0.1)).toBeCloseTo(4);
  });

  it('effective ppm is the bottleneck axis', () => {
    // (xDim 0.4, 8192 px, 512 mm, step 0.1) -> min(6.4, 4) = 4.0.
    expect(effectivePpm(0.4, 8192, 512, 0.1)).toBeCloseTo(4.0);
    // Cross-belt becomes the bottleneck for large modules:
    // min(400/0.0625 = 6400, 400/0.1 = 4000) = 4000.
    expect(effectivePpm(400, 8192, 512, 0.1)).toBeCloseTo(4000);
  });
});

describe('plane crossing detection', () => {
  it('a full pass yields exactly one front and one rear crossing', () => {
    // Parcel 200 mm long, edges starting at frontZ=120 / rearZ=320
    // (mid-pass straddle of plane 200). Step the whole pass in +z from
    // fully-before (front 100, rear -100) to fully-after (front 400, rear 200+).
    const plane = 200;
    let frontCrossings = 0;
    let rearCrossings = 0;
    let frontZ = 100;
    let rearZ = -100;
    for (let i = 0; i < 30; i++) {
      const nextFront = frontZ + 10;
      const nextRear = rearZ + 10;
      const c = parcelPlaneCrossings(frontZ, rearZ, nextFront, nextRear, plane);
      frontCrossings += c.frontCrossed ? 1 : 0;
      rearCrossings += c.rearCrossed ? 1 : 0;
      frontZ = nextFront;
      rearZ = nextRear;
    }
    expect(frontZ).toBe(400);
    expect(frontCrossings).toBe(1);
    expect(rearCrossings).toBe(1);
  });

  it('is robust to step size (large steps skip the plane, still one crossing)', () => {
    const plane = 200;
    let frontCrossings = 0;
    let rearCrossings = 0;
    let frontZ = 100;
    let rearZ = -100;
    for (let i = 0; i < 12; i++) {
      const nextFront = frontZ + 137;
      const nextRear = rearZ + 137;
      const c = parcelPlaneCrossings(frontZ, rearZ, nextFront, nextRear, plane);
      frontCrossings += c.frontCrossed ? 1 : 0;
      rearCrossings += c.rearCrossed ? 1 : 0;
      frontZ = nextFront;
      rearZ = nextRear;
    }
    expect(frontCrossings).toBe(1);
    expect(rearCrossings).toBe(1);
  });

  it('lands exactly on the plane without double counting', () => {
    // 199 -> 200 registers the crossing; 200 -> 201 does not re-fire.
    expect(edgeCrossedPlane(199, 200, 200)).toBe(true);
    expect(edgeCrossedPlane(200, 201, 200)).toBe(false);
    // A parcel resting on the plane does not trigger.
    expect(edgeCrossedPlane(200, 200, 200)).toBe(false);
  });

  it('a parcel fully past the plane yields no crossings', () => {
    const c = parcelPlaneCrossings(500, 700, 510, 710, 200);
    expect(c.frontCrossed).toBe(false);
    expect(c.rearCrossed).toBe(false);
  });

  it('works for motion in the -z direction', () => {
    // Parcel moving in -z: edge 320 -> 190 crosses plane 200 once.
    expect(edgeCrossedPlane(320, 190, 200)).toBe(true);
    expect(edgeCrossedPlane(190, 180, 200)).toBe(false);
  });
});

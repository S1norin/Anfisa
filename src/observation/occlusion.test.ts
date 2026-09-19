/**
 * Occlusion (PIPE-001): parcel AABBs (exact under yaw), slab ray test,
 * and label occlusion by other parcels.
 */

import type { ParcelState } from '../domain/types';
import { labelCenterWorldMm } from './projection';
import { labelOccludedMm, parcelAabbMm, rayAabbMm, type Aabb } from './occlusion';

function makeParcel(
  parcelId: string,
  frontZMm: number,
  over: Partial<ParcelState> = {},
): ParcelState {
  return {
    parcelId,
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
    frontZMm,
    phase: 'SPAWNED',
    ...over,
  };
}

describe('parcelAabbMm', () => {
  it('matches the axis-aligned parcel (no yaw)', () => {
    const p = makeParcel('P-1', 1500);
    const box = parcelAabbMm(p);
    expect(box.min).toEqual([-200, 0, 1200]);
    expect(box.max).toEqual([200, 120, 1500]);
  });

  it('grows to the rotated footprint under yaw (never under-estimates)', () => {
    const p = makeParcel('P-1', 1500);
    const rotated = { ...p, spec: { ...p.spec, yawDeg: 45 } };
    const box = parcelAabbMm(rotated);
    // 45°: half-diagonal of (400, 300) → x/z half-extent
    // (200·cos45 + 150·sin45) ≈ 247.5
    const half = (200 + 150) * Math.SQRT1_2;
    expect(box.max[0] - box.min[0]).toBeCloseTo(2 * half, 6);
    expect(box.max[2] - box.min[2]).toBeCloseTo(2 * half, 6);
    expect(box.min[1]).toBe(0);
    expect(box.max[1]).toBe(120);
  });

  it('follows lateral offset', () => {
    const p = makeParcel('P-1', 1500, {
      spec: { ...makeParcel('P-1', 1500).spec, lateralOffsetMm: 100 },
    });
    const box = parcelAabbMm(p);
    expect(box.min[0]).toBe(-100);
    expect(box.max[0]).toBe(300);
  });
});

describe('rayAabbMm (slab test)', () => {
  const box: Aabb = { min: [-10, -10, 10], max: [10, 10, 30] };

  it('hits a box in front of the origin', () => {
    const t = rayAabbMm([0, 0, 0], [0, 0, 1], box);
    expect(t).toBeCloseTo(10, 9);
  });

  it('misses a box behind the origin', () => {
    expect(rayAabbMm([0, 0, 0], [0, 0, -1], box)).toBeNull();
  });

  it('misses when the ray passes beside the box', () => {
    expect(rayAabbMm([100, 0, 0], [0, 0, 1], box)).toBeNull();
  });

  it('misses an axial ray outside the slab', () => {
    // dir has zero y, origin outside the y-slab.
    expect(rayAabbMm([0, 100, 0], [1, 0, 0], box)).toBeNull();
  });

  it('origin inside the box returns t = 0', () => {
    expect(rayAabbMm([0, 0, 20], [0, 0, 1], box)).toBeCloseTo(0, 9);
  });

  it('oblique ray entry point', () => {
    // From (−20, 0, 0) toward (1, 0, 1): enters at x = −10 → t = 10.
    const t = rayAabbMm([-20, 0, 0], [1 / Math.SQRT2, 0, 1 / Math.SQRT2], box);
    expect(t).toBeCloseTo(10 * Math.SQRT2, 6);
  });
});

describe('labelOccludedMm', () => {
  // Low camera at parcel height so the ray runs THROUGH other parcels
  // (a high FRONT rig looks over the 120 mm parcels — labelled choice).
  const camPos: [number, number, number] = [0, 100, -2000];

  function labelCenter(parcel: ParcelState): [number, number, number] {
    return labelCenterWorldMm(
      {
        labelInstanceId: 'L',
        payload: 'KTY-1',
        face: 'REAR',
        localOffsetMm: [0, 0],
        rotationDeg: 0,
        widthMm: 78,
        heightMm: 25,
        damage: 0,
      },
      parcel,
    );
  }

  it('the farther parcel is occluded by the nearer one (same lane)', () => {
    const near = makeParcel('P-near', 1500); // centre z ≈ 1350
    const far = makeParcel('P-far', 2500); // centre z ≈ 2350
    expect(labelOccludedMm(camPos, labelCenter(far), far, [near, far])).toBe(true);
    expect(labelOccludedMm(camPos, labelCenter(near), near, [near, far])).toBe(false);
  });

  it('a parcel in another lane does not occlude', () => {
    const near = makeParcel('P-near', 1500);
    const far = makeParcel('P-far', 2500, {
      spec: { ...makeParcel('P-far', 2500).spec, lateralOffsetMm: 500 },
    });
    expect(labelOccludedMm(camPos, labelCenter(far), far, [near, far])).toBe(false);
  });

  it('a parcel behind the camera does not occlude a label in front', () => {
    const behind = makeParcel('P-behind', -2500);
    const target = makeParcel('P-target', 1500);
    expect(
      labelOccludedMm(camPos, labelCenter(target), target, [behind, target]),
    ).toBe(false);
  });

  it('the parcel itself is never an occluder', () => {
    const p = makeParcel('P-1', 1500);
    expect(labelOccludedMm(camPos, labelCenter(p), p, [p])).toBe(false);
  });

  it('a yawed nearer parcel still occludes (exact AABB)', () => {
    const near = makeParcel('P-near', 1500, {
      spec: { ...makeParcel('P-near', 1500).spec, yawDeg: 30 },
    });
    const far = makeParcel('P-far', 2500);
    expect(labelOccludedMm(camPos, labelCenter(far), far, [near, far])).toBe(true);
  });
});

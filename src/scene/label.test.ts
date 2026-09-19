import * as THREE from 'three';
import type { Face, LabelInstance, ParcelSpec } from '../domain/types';
import { faceTransform, labelGeometry } from './label';
import { mmToM } from '../domain/units';

function makeSpec(): ParcelSpec {
  return {
    widthMm: 400,
    heightMm: 400,
    lengthMm: 600,
    lateralOffsetMm: 0,
    yawDeg: 0,
    material: 'KRAFT',
    tape: false,
    labels: [],
  };
}

const NORMALS: Record<string, [number, number, number]> = {
  FRONT: [0, 0, 1],
  REAR: [0, 0, -1],
  LEFT: [-1, 0, 0],
  RIGHT: [1, 0, 0],
  TOP: [0, 1, 0],
  BOTTOM: [0, -1, 0],
};

describe('face transforms (PAR-003)', () => {
  it('every face has its outward normal and correct centre', () => {
    const spec = makeSpec();
    const W = mmToM(400) / 2;
    const H = mmToM(400) / 2;
    const L = mmToM(600) / 2;
    const centres: Record<string, [number, number, number]> = {
      FRONT: [0, 0, L],
      REAR: [0, 0, -L],
      LEFT: [-W, 0, 0],
      RIGHT: [W, 0, 0],
      TOP: [0, H, 0],
      BOTTOM: [0, -H, 0],
    };
    for (const [face, normal] of Object.entries(NORMALS)) {
      const ft = faceTransform(face as Face, spec);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(ft.quaternion);
      expect(n.distanceTo(new THREE.Vector3(...normal))).toBeLessThan(1e-9);
      expect(ft.center.distanceTo(new THREE.Vector3(...centres[face]))).toBeLessThan(1e-9);
    }
  });

  it('u/v axes are orthogonal to the normal', () => {
    const spec = makeSpec();
    for (const face of Object.keys(NORMALS) as Face[]) {
      const ft = faceTransform(face, spec);
      const u = new THREE.Vector3(1, 0, 0).applyQuaternion(ft.quaternion);
      const v = new THREE.Vector3(0, 1, 0).applyQuaternion(ft.quaternion);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(ft.quaternion);
      expect(u.dot(n)).toBeCloseTo(0, 9);
      expect(v.dot(n)).toBeCloseTo(0, 9);
      expect(u.dot(v)).toBeCloseTo(0, 9);
    }
  });
});

describe('label geometry (PAR-004)', () => {
  const label = (over: Partial<LabelInstance> = {}): LabelInstance => ({
    labelInstanceId: 'L-0000',
    payload: 'KTY-12345678901234',
    face: 'FRONT',
    localOffsetMm: [0, 0],
    rotationDeg: 0,
    widthMm: 78,
    heightMm: 25,
    ...over,
  });

  it('centres the label on the face centre for zero offset', () => {
    const spec = makeSpec();
    const geo = labelGeometry(label(), spec);
    const front = faceTransform('FRONT', spec);
    expect(geo.position.distanceTo(front.center)).toBeCloseTo(0.001, 6);
  });

  it('offsets along the face u/v axes', () => {
    const spec = makeSpec();
    const geo = labelGeometry(label({ face: 'FRONT', localOffsetMm: [10, 20] }), spec);
    const ft = faceTransform('FRONT', spec);
    const expected = ft.center
      .clone()
      .add(new THREE.Vector3(mmToM(10), mmToM(20), 0.001));
    expect(geo.position.distanceTo(expected)).toBeLessThan(1e-9);
  });

  it('rotation spins about the face normal (not a world axis)', () => {
    const spec = makeSpec();
    const base = labelGeometry(label({ face: 'LEFT', rotationDeg: 0 }), spec);
    const spun = labelGeometry(label({ face: 'LEFT', rotationDeg: 90 }), spec);
    // Same position (rotation about the label centre).
    expect(spun.position.distanceTo(base.position)).toBeLessThan(1e-12);
    // 90 deg about the LEFT face normal (world -x): local +u (world +z)
    // maps to world +y.
    const u = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(spun.quaternion)
      .normalize();
    expect(u.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9);
  });

  it('keeps label extents as configured', () => {
    const spec = makeSpec();
    const geo = labelGeometry(label({ widthMm: 100, heightMm: 40 }), spec);
    expect(geo.widthM).toBeCloseTo(0.1, 9);
    expect(geo.heightM).toBeCloseTo(0.04, 9);
  });
});

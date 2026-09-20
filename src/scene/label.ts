/**
 * Label placement on parcel faces (PAR-003, PAR-004 — render layer).
 *
 * Pure THREE builders so they run in node tests (no WebGL).
 * Face-local convention (matching domain/label.ts):
 *   u — first face-local axis, v — second; +z is the outward normal.
 * The label plane's local x = u, local y = v.
 *
 * Units: metres (mm converted at the boundary).
 */

import * as THREE from 'three';
import { degToRad, mmToM } from '../domain/units';
import type { Face, LabelInstance, ParcelSpec } from '../domain/types';

export interface FaceTransform {
  /** Face centre in parcel-local metres. */
  center: THREE.Vector3;
  /** Rotation mapping label-plane axes (x=u, y=v, z=normal) to parcel axes. */
  quaternion: THREE.Quaternion;
}

const HALF_PI = Math.PI / 2;

/** Face transforms for a parcel centred at the origin (metres). */
export function faceTransform(face: Face, spec: ParcelSpec): FaceTransform {
  const W = mmToM(spec.widthMm) / 2;
  const H = mmToM(spec.heightMm) / 2;
  const L = mmToM(spec.lengthMm) / 2;
  const q = (x: number, y: number, z: number) =>
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

  switch (face) {
    case 'FRONT': // +z normal; u=+x, v=+y
      return { center: new THREE.Vector3(0, 0, L), quaternion: q(0, 0, 0) };
    case 'REAR': // -z normal; u=-x, v=+y
      return { center: new THREE.Vector3(0, 0, -L), quaternion: q(0, Math.PI, 0) };
    case 'LEFT': // -x normal; u=+z, v=+y
      return { center: new THREE.Vector3(-W, 0, 0), quaternion: q(0, -HALF_PI, 0) };
    case 'RIGHT': // +x normal; u=-z, v=+y
      return { center: new THREE.Vector3(W, 0, 0), quaternion: q(0, HALF_PI, 0) };
    case 'TOP': // +y normal; u=+x, v=-z
      return { center: new THREE.Vector3(0, H, 0), quaternion: q(-HALF_PI, 0, 0) };
    case 'BOTTOM': // -y normal; u=+x, v=+z
      return { center: new THREE.Vector3(0, -H, 0), quaternion: q(HALF_PI, 0, 0) };
  }
}

export interface LabelGeometry {
  /** Label centre in parcel-local metres. */
  position: THREE.Vector3;
  /** Full orientation: face transform + in-plane rotation. */
  quaternion: THREE.Quaternion;
  widthM: number;
  heightM: number;
}

/**
 * Compute the label plane pose for a LabelInstance (parcel-local metres).
 * A 1 mm offset along the outward normal avoids z-fighting with the face.
 */
export function labelGeometry(label: LabelInstance, spec: ParcelSpec): LabelGeometry {
  const ft = faceTransform(label.face, spec);
  const offset = new THREE.Vector3(
    mmToM(label.localOffsetMm[0]),
    mmToM(label.localOffsetMm[1]),
    0,
  ).applyQuaternion(ft.quaternion);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(ft.quaternion);
  const position = ft.center.clone().add(offset).addScaledVector(normal, 0.001);
  const spin = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    degToRad(label.rotationDeg),
  );
  return {
    position,
    quaternion: ft.quaternion.clone().multiply(spin),
    widthM: mmToM(label.widthMm),
    heightM: mmToM(label.heightMm),
  };
}

/**
 * Build a label mesh (box, 2 mm thick — a real sticker has depth; a plane
 * would z-fight when the label is on a face and viewed edge-on).
 * Caller owns the texture (and its disposal).
 */
export function buildLabelMesh(
  label: LabelInstance,
  spec: ParcelSpec,
  texture: THREE.Texture,
): THREE.Mesh {
  const geo = labelGeometry(label, spec);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(geo.widthM, geo.heightM, 0.002),
    new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0.0,
    }),
  );
  mesh.position.copy(geo.position);
  mesh.quaternion.copy(geo.quaternion);
  mesh.name = `label-${label.labelInstanceId}`;
  mesh.userData = {
    part: 'label',
    labelInstanceId: label.labelInstanceId,
    face: label.face,
  };
  return mesh;
}

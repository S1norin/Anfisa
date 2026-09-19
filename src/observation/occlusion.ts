/**
 * Occlusion (PIPE-001): a conservative ray test against the other
 * parcels' world-axis-aligned bounding boxes.
 *
 * Approximation (labelled demo assumption): the ray goes from the camera
 * position to the label CENTRE; the occluder AABBs are the exact AABB of
 * the yaw-rotated parcel (computed from its 8 corners), so a yawed parcel
 * never under-estimates its own silhouette.
 */

import type { ParcelState } from '../domain/types';
import { degToRad } from '../domain/units';

export type V3 = [number, number, number];

export interface Aabb {
  min: V3;
  max: V3;
}

/** Exact world AABB of a parcel (yaw-rotated footprint, unrotated height). */
export function parcelAabbMm(parcel: ParcelState): Aabb {
  const s = parcel.spec;
  const φ = degToRad(s.yawDeg);
  const c = Math.cos(φ);
  const sn = Math.sin(φ);
  const cx = s.lateralOffsetMm;
  const cz = parcel.frontZMm - s.lengthMm / 2;
  const hw = s.widthMm / 2;
  const hl = s.lengthMm / 2;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const dx of [-hw, hw]) {
    for (const dz of [-hl, hl]) {
      const x = cx + dx * c + dz * sn;
      const z = cz - dx * sn + dz * c;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  return { min: [minX, 0, minZ], max: [maxX, s.heightMm, maxZ] };
}

/**
 * Slab ray/AABB test. Returns the entry distance t ≥ 0, or null.
 * dir must be finite; near-zero axes are handled as misses when the
 * origin is outside the slab.
 */
export function rayAabbMm(origin: V3, dir: V3, box: Aabb): number | null {
  let tMin = 0;
  let tMax = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = dir[i];
    const o = origin[i];
    if (Math.abs(d) < 1e-12) {
      if (o < box.min[i] - 1e-9 || o > box.max[i] + 1e-9) return null;
      continue;
    }
    let t1 = (box.min[i] - o) / d;
    let t2 = (box.max[i] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/**
 * Is `label` on `parcel` occluded from `rig` by any OTHER parcel?
 * The camera position is the ray origin; the label centre is the target.
 */
export function labelOccludedMm(
  camPos: V3,
  labelCenter: V3,
  parcel: ParcelState,
  allParcels: ParcelState[],
): boolean {
  const toLabel: V3 = [
    labelCenter[0] - camPos[0],
    labelCenter[1] - camPos[1],
    labelCenter[2] - camPos[2],
  ];
  const dist = Math.hypot(...toLabel);
  if (dist < 1e-9) return false;
  const dir: V3 = [toLabel[0] / dist, toLabel[1] / dist, toLabel[2] / dist];
  for (const other of allParcels) {
    if (other.parcelId === parcel.parcelId) continue;
    const t = rayAabbMm(camPos, dir, parcelAabbMm(other));
    if (t != null && t < dist - 1e-6) return true;
  }
  return false;
}

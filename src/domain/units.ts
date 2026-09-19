/**
 * Domain units and coordinate system (SIM-001).
 *
 * All domain values are in MILLIMETRES and MILLISECONDS.
 *
 * Coordinate system (right-handed, metres are converted at render time only):
 *   x — across the belt (0 = belt centre; ±width/2 at belt edges)
 *   y — up (0 = belt surface)
 *   z — direction of travel (0 = entry photoeye, stationLengthMm = exit photoeye)
 */

export const UNITS = {
  length: 'mm',
  time: 'ms',
  angle: 'deg',
  px: 'px',
} as const;

export interface Vec3Mm {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3Mm => ({ x, y, z });

export const mmToM = (mm: number): number => mm / 1000;
export const mToMm = (m: number): number => m * 1000;
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

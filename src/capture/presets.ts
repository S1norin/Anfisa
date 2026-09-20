/**
 * Recommended 6-view preset (issue #14 will expose this in the Camera Lab).
 *
 * The baseline scenario (issue #10) needs a deliberately easy, fully readable
 * 6-view geometry: one camera per face, long working distance, stopped-down
 * aperture (f/22 proxy) so the whole face stays in focus, and quality
 * thresholds tuned to that geometry. The thresholds are editable config
 * (CFG-003) — the preset bundles rig + thresholds so a run is reproducible
 * from a single named config (CFG-004).
 *
 * Geometry (parcel 400×400×600 at the station centre, belt top y=0):
 *  - FRONT/REAR: 800 mm off the end faces, level with face mid-height.
 *  - LEFT/RIGHT: 929 mm off the side faces (1129 mm from belt centreline),
 *    level with face mid-height.
 *  - TOP/BOTTOM: 900 mm off the top/bottom faces, over the station centre.
 *
 * Verified (issue #10 probe): at xDimension 1.1 mm every label position on
 * every face scores quality 1.000 with ppmTarget 2.2 / focusPxTarget 2.0.
 */

import {
  defaultCameraRigs,
  lookAtQuaternion,
  type StationGeometry,
} from '../domain/camera';
import { defaultConfig, type SimConfig } from '../domain/config';
import type { CameraConfig } from '../domain/types';

type V3 = [number, number, number];

/** Stopped-down proxy aperture for the preset (deep depth of field). */
const PRESET_APERTURE = 22;
/** End-face working distance (mm). */
const END_WORKING_DISTANCE_MM = 800;
/** Side-face working distance (mm, face plane to eye). */
const SIDE_WORKING_DISTANCE_MM = 929;
/** Top/bottom working distance (mm, face plane to eye). */
const TOP_WORKING_DISTANCE_MM = 900;

export function aim(
  rig: CameraConfig,
  eye: V3,
  target: V3,
): CameraConfig {
  const pose = {
    positionMm: eye,
    quaternion: lookAtQuaternion(eye, target),
  };
  const dist = Math.hypot(
    eye[0] - target[0],
    eye[1] - target[1],
    eye[2] - target[2],
  );
  return {
    ...rig,
    pose,
    acquisition: { ...rig.acquisition, focusDistanceMm: dist },
    optics: { ...rig.optics, apertureProxy: PRESET_APERTURE },
  };
}

/** The recommended 6-view rigs for a given config's station/parcel sizes. */
export function recommendedSixViewRigs(config: SimConfig): CameraConfig[] {
  const station: StationGeometry = {
    lengthMm: config.station.lengthMm,
    beltWidthMm: config.belt.widthMm,
  };
  const defaults = {
    sensorWidthPx: config.cameras.sensorWidthPx,
    sensorHeightPx: config.cameras.sensorHeightPx,
    focalLengthMm: config.cameras.focalLengthMm,
    exposureUs: config.cameras.exposureUs,
    fps: config.cameras.fps,
    shutter: config.cameras.shutter,
  };
  const rigs = defaultCameraRigs(station, defaults);
  const by = (role: string) => rigs.find((r) => r.role === role)!;

  const cz = config.station.lengthMm / 2; // station centre (parcel centre z)
  const midY = config.parcel.heightMm / 2; // label mid-height
  const halfW = config.parcel.widthMm / 2;
  const frontZ = cz + config.parcel.lengthMm / 2;
  const rearZ = cz - config.parcel.lengthMm / 2;

  return [
    aim(
      by('FRONT'),
      [0, midY, frontZ + END_WORKING_DISTANCE_MM],
      [0, midY, frontZ],
    ),
    aim(
      by('REAR'),
      [0, midY, rearZ - END_WORKING_DISTANCE_MM],
      [0, midY, rearZ],
    ),
    aim(
      by('LEFT'),
      [-(halfW + SIDE_WORKING_DISTANCE_MM), midY, cz],
      [-halfW, midY, cz],
    ),
    aim(
      by('RIGHT'),
      [halfW + SIDE_WORKING_DISTANCE_MM, midY, cz],
      [halfW, midY, cz],
    ),
    aim(
      by('TOP'),
      [0, config.parcel.heightMm + TOP_WORKING_DISTANCE_MM, cz],
      [0, config.parcel.heightMm, cz],
    ),
    aim(
      by('BOTTOM'),
      [0, -TOP_WORKING_DISTANCE_MM, cz],
      [0, 0, cz],
    ),
  ];
}

/**
 * The full baseline config: recommended 6-view rigs + thresholds tuned to
 * that geometry + clean kraft parcels, no tape (no glare).
 */
export function recommendedSixViewConfig(): SimConfig {
  const cfg = defaultConfig();
  cfg.cameraRigs = recommendedSixViewRigs(cfg);
  // Realistic Code 128 module width (default 0.3 mm is a stress case).
  cfg.barcode.xDimensionMm = 1.1;
  // Thresholds tuned to the preset geometry (worst-case face corner):
  // ppm 2.20, CoC 1.85 px, angle 34°, blur 0.43 px.
  cfg.quality.ppmTarget = 2.2;
  cfg.quality.focusPxTarget = 2;
  cfg.quality.focusPxMax = 5;
  // Clean baseline: no glossy tape strips (glare would not gate, but keep
  // the scenario exactly as specified).
  cfg.parcel.tapeChance = 0;
  return cfg;
}

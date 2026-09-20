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
  defaultLineScanRig,
  lookAtQuaternion,
  type StationGeometry,
} from '../domain/camera';
import { defaultConfig, type SimConfig } from '../domain/config';
import type { AreaScanCameraConfig, CameraRole } from '../domain/types';
import {
  REPORT_BARCODE,
  REPORT_LINE,
  REPORT_SIDE,
  reportSideMounts,
} from '../report/reportSpec';

type V3 = [number, number, number];

/** Canonicalize -0 → +0 so preset configs JSON round-trip bit-identical. */
const z = (n: number): number => (n === 0 ? 0 : n);
const cleanPose = (pose: { positionMm: V3; quaternion: [number, number, number, number] }) => ({
  positionMm: [z(pose.positionMm[0]), z(pose.positionMm[1]), z(pose.positionMm[2])] as V3,
  quaternion: [
    z(pose.quaternion[0]),
    z(pose.quaternion[1]),
    z(pose.quaternion[2]),
    z(pose.quaternion[3]),
  ] as [number, number, number, number],
});

/** Stopped-down proxy aperture for the preset (deep depth of field). */
const PRESET_APERTURE = 22;
/** End-face working distance (mm). */
const END_WORKING_DISTANCE_MM = 800;
/** Side-face working distance (mm, face plane to eye). */
const SIDE_WORKING_DISTANCE_MM = 929;
/** Top/bottom working distance (mm, face plane to eye). */
const TOP_WORKING_DISTANCE_MM = 900;

export function aim(
  rig: AreaScanCameraConfig,
  eye: V3,
  target: V3,
): AreaScanCameraConfig {
  const pose = {
    positionMm: eye,
    quaternion: lookAtQuaternion(eye, target),
  };
  const dist = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
  return {
    ...rig,
    pose,
    acquisition: { ...rig.acquisition, focusDistanceMm: dist },
    optics: { ...rig.optics, apertureProxy: PRESET_APERTURE },
  };
}

/** The recommended 6-view rigs for a given config's station/parcel sizes. */
export function recommendedSixViewRigs(config: SimConfig): AreaScanCameraConfig[] {
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
    aim(by('FRONT'), [0, midY, frontZ + END_WORKING_DISTANCE_MM], [0, midY, frontZ]),
    aim(by('REAR'), [0, midY, rearZ - END_WORKING_DISTANCE_MM], [0, midY, rearZ]),
    aim(by('LEFT'), [-(halfW + SIDE_WORKING_DISTANCE_MM), midY, cz], [-halfW, midY, cz]),
    aim(by('RIGHT'), [halfW + SIDE_WORKING_DISTANCE_MM, midY, cz], [halfW, midY, cz]),
    aim(
      by('TOP'),
      [0, config.parcel.heightMm + TOP_WORKING_DISTANCE_MM, cz],
      [0, config.parcel.heightMm, cz],
    ),
    aim(by('BOTTOM'), [0, -TOP_WORKING_DISTANCE_MM, cz], [0, 0, cz]),
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

/**
 * Layout described in Report Draft.md: four horizontal side readers spaced
 * by 90 degrees and aimed obliquely (45 degrees to the parcel faces), plus
 * dedicated top and bottom readers. In config v3 the top/bottom readers are
 * encoder-synced line scanners (LINE_SCAN). The report also specifies a 100
 * mm gap between two conveyor sections for the bottom view.
 */
export function reportSixViewConfig(): SimConfig {
  const cfg = defaultConfig();
  const base = defaultCameraRigs(
    { lengthMm: cfg.station.lengthMm, beltWidthMm: cfg.belt.widthMm },
    {
      sensorWidthPx: cfg.cameras.sensorWidthPx,
      sensorHeightPx: cfg.cameras.sensorHeightPx,
      focalLengthMm: cfg.cameras.focalLengthMm,
      exposureUs: 140,
      fps: 25,
      shutter: 'GLOBAL',
    },
  );
  const by = (role: AreaScanCameraConfig['role']) => base.find((r) => r.role === role)!;
  const centre: V3 = [0, cfg.parcel.heightMm / 2, cfg.station.lengthMm / 2];
  const radius = 1250;
  const diagonal = radius * Math.SQRT1_2;

  const side = (role: 'FRONT' | 'REAR' | 'LEFT' | 'RIGHT', name: string, x: number, z: number) => {
    const rig = by(role);
    const aimed = aim(
      {
        ...rig,
        name,
        sensor: {
          ...rig.sensor,
          widthPx: 9000,
          heightPx: 6000,
          // ~793 mm horizontal field at the 1.25 m centre distance from
          // the report's diagonal/FOV calculation.
          focalLengthMm: 37,
        },
      },
      [x, centre[1], z],
      centre,
    );
    return {
      ...aimed,
      // A 9K oblique view turns belt motion into many more pixels than the
      // report's top-view estimate. Use a short polarized strobe and focus
      // on the near parcel faces rather than the parcel centre.
      acquisition: {
        ...aimed.acquisition,
        exposureUs: 15,
        focusDistanceMm: 890,
        gainDb: 10,
      },
      illumination: {
        ...aimed.illumination,
        intensity: 2,
        strobeUs: 15,
      },
    };
  };

  // TOP/BOTTOM are encoder-synced line scanners (v3 LINE_SCAN): a line
  // sensor across the belt acquires one row per encoder step while a
  // parcel crosses the scan plane. Preset assumptions (labelled, per the
  // line-scan plan doc): 8192 px/line over a 512 mm line (0.0625 mm/
  // pixel); 0.1 mm encoder step per line -> 4 travel lines per 0.4 mm
  // module (clears the ppmMin 2.0 gate at rest); 12 000 lines/s ceiling
  // -> saturated at 1.2 m/s, so 1.5 m/s intentionally undersamples
  // (LOW_PPM by design). These are the defaultLineScanRig defaults.
  const topEye: V3 = [0, cfg.parcel.heightMm + TOP_WORKING_DISTANCE_MM, centre[2]];
  const bottomEye: V3 = [0, -TOP_WORKING_DISTANCE_MM, centre[2]];

  cfg.cameraRigs = [
    side('FRONT', 'FRONT-RIGHT 45° reader', diagonal, centre[2] + diagonal),
    side('REAR', 'REAR-LEFT 45° reader', -diagonal, centre[2] - diagonal),
    side('LEFT', 'FRONT-LEFT 45° reader', -diagonal, centre[2] + diagonal),
    side('RIGHT', 'REAR-RIGHT 45° reader', diagonal, centre[2] - diagonal),
    defaultLineScanRig(
      'CAM-005',
      'TOP',
      topEye,
      lookAtQuaternion(topEye, [0, cfg.parcel.heightMm, centre[2]]),
      centre[2],
    ),
    defaultLineScanRig(
      'CAM-006',
      'BOTTOM',
      bottomEye,
      lookAtQuaternion(bottomEye, [0, 0, centre[2]]),
      // The BOTTOM scan plane sits at the GAP centre: the 100 mm transfer
      // opening is centred on the station, so bottom strips are only
      // useful while the parcel interval overlaps the gap.
      centre[2],
    ),
  ];
  cfg.station.bottomTransfer = 'GAP';
  cfg.barcode.xDimensionMm = 0.4;
  cfg.cameras.exposureUs = 140;
  cfg.cameras.fps = 25;
  // In this preset 45° is intentional operating geometry, not a degraded
  // edge case. Keep a hard rejection beyond 65° for genuinely poor views.
  cfg.quality.incidenceDegTarget = 50;
  cfg.quality.incidenceDegMax = 65;
  cfg.quality.focusPxTarget = 2;
  cfg.quality.focusPxMax = 5;
  return cfg;
}

/**
 * The final report's eight-reader layout (REPORT_ALIGNMENT_PLAN.md, the
 * only design contract): six side area cameras at 60° directions (three
 * per conveyor side) plus top and bottom line scanners, on the 100 mm
 * bottom transfer gap. Every optical value comes from
 * `src/report/reportSpec.ts` — nothing here is invented.
 *
 * Report values used: 8000×4500 px @ 4.5 µm side sensors, 55 mm lens at
 * 1450 mm working distance (25 FPS, 75 µs, global shutter); line scanners
 * 8192 px over a 715 mm scan-plane FOV (40.96 mm physical), 0.1 mm
 * encoder step, 12 000 lines/s ceiling, 100 mm bottom gap, 0.35 mm
 * barcode module.
 */
export function reportEightReaderConfig(): SimConfig {
  const cfg = defaultConfig();
  // The report's bottom view requires the 100 mm transfer opening.
  cfg.station.bottomTransfer = 'GAP';
  cfg.barcode.xDimensionMm = REPORT_BARCODE.xDimensionMm;
  // The 715 mm / 8192 px scan plane (0.0873 mm/px) moves ~40% more per
  // pixel than the legacy 512 mm line: at the report's 50 µs line
  // exposure and 1 m/s the belt blur is 0.57 px, so the blur target moves
  // with the geometry (max stays 1.0 px = ~0.087 mm of belt travel).
  cfg.quality.blurPxTarget = 0.6;

  const station: StationGeometry = {
    lengthMm: cfg.station.lengthMm,
    beltWidthMm: cfg.belt.widthMm,
  };
  const mounts = reportSideMounts(cfg.station.lengthMm, cfg.parcel.heightMm);
  const base = defaultCameraRigs(station, {
    sensorWidthPx: REPORT_SIDE.sensorWidthPx,
    sensorHeightPx: REPORT_SIDE.sensorHeightPx,
    focalLengthMm: REPORT_SIDE.focalLengthMm,
    exposureUs: REPORT_SIDE.exposureUsPreset,
    fps: REPORT_SIDE.fpsPreset,
    shutter: REPORT_SIDE.shutter,
  });
  const template = base.find((r) => r.role === 'FRONT')!;
  // Human names follow the direction angles (from +z toward +x).
  const sideNames = [
    'Side reader · FRONT-RIGHT 30°',
    'Side reader · RIGHT 90°',
    'Side reader · REAR-RIGHT 150°',
    'Side reader · REAR-LEFT 210°',
    'Side reader · LEFT 270°',
    'Side reader · FRONT-LEFT 330°',
  ];
  const sides: AreaScanCameraConfig[] = mounts.map((m, i) =>
    aim(
      {
        ...template,
        id: `CAM-${String(i + 1).padStart(3, '0')}`,
        role: 'CUSTOM' as CameraRole,
        name: sideNames[i],
      },
      m.positionMm,
      m.targetMm,
    ),
  );

  // Top/bottom line scanners: the report's 715 mm FOV, 8192 px, 0.1 mm
  // step, 12 kHz ceiling; top plane 150 mm above the parcel top, bottom
  // plane in the 100 mm gap (both labelled reportSpec assumptions).
  const cz = cfg.station.lengthMm / 2;
  // The top eye sits 150 mm ABOVE the parcel top face (reportSpec
  // working distance); the bottom eye in the 100 mm transfer gap.
  const topEye: V3 = [0, cfg.parcel.heightMm + REPORT_LINE.topWorkingDistanceMm, cz];
  const bottomEye: V3 = [0, -REPORT_LINE.bottomGapMm, cz];
  const lineOverrides = {
    physicalSensorWidthMm: REPORT_LINE.physicalSensorWidthMm,
    fovWidthMm: REPORT_LINE.fovWidthMm,
    encoderStepMmPerLine: REPORT_LINE.encoderStepMmPerLine,
    maxLineRateLinesPerSec: REPORT_LINE.maxLineRateLinesPerSec,
    // 50 µs — floor of the report 50–100 µs global-shutter band: keeps
    // belt-motion blur under the blurPxTarget ramp at the 1 m/s operating
    // speed (0.57 px vs 0.86 px at 75 µs).
    lineExposureUs: REPORT_SIDE.exposureUsMin,
  };
  const top = defaultLineScanRig(
    'CAM-007',
    'TOP',
    topEye,
    lookAtQuaternion(topEye, [0, cfg.parcel.heightMm, cz]),
    cz,
    lineOverrides,
  );
  const bottom = defaultLineScanRig(
    'CAM-008',
    'BOTTOM',
    bottomEye,
    lookAtQuaternion(bottomEye, [0, 0, cz]),
    cz,
    lineOverrides,
  );

  cfg.cameraRigs = [...sides, top, bottom].map((r) => ({
    ...r,
    pose: cleanPose(r.pose),
  }));
  // The report's acquisition bands are encoded per rig; mirror them in the
  // global camera block so the Schema view and the rigs agree.
  cfg.cameras.sensorWidthPx = REPORT_SIDE.sensorWidthPx;
  cfg.cameras.sensorHeightPx = REPORT_SIDE.sensorHeightPx;
  cfg.cameras.focalLengthMm = REPORT_SIDE.focalLengthMm;
  cfg.cameras.exposureUs = REPORT_SIDE.exposureUsPreset;
  cfg.cameras.fps = REPORT_SIDE.fpsPreset;
  // The 0.35 mm module is demanding: the default ppm floor (2.0) is the
  // report's minimum-ppm rule and is met (side ≥ 3.07, line travel 3.5).
  return cfg;
}

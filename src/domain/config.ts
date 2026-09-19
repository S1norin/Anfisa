/**
 * Versioned simulation config with the §4 defaults.
 * All user-editable values live here; presets (issue #14) mutate this object,
 * never hidden constants. JSON round-trippable (CFG-003).
 */
import type { CameraConfig, MaterialPreset } from './types';

export const CONFIG_VERSION = 1;

export interface QualityThresholds {
  /** Hard gate: minimum full-label coverage fraction. */
  coverageMin: number;
  /** Hard gate / target projected pixels per module. */
  ppmMin: number;
  ppmTarget: number;
  /** Hard gate / target motion blur in px. */
  blurPxMax: number;
  blurPxTarget: number;
  /** Hard gate / target incidence angle in degrees. */
  incidenceDegMax: number;
  incidenceDegTarget: number;
  /** Seeded probability band around the quality boundary (0..1). */
  boundaryBand: number;
}

export interface SimConfig {
  version: number;
  seed: number;
  belt: {
    widthMm: number;
    speedMmPerSec: number;
    speedMinMmPerSec: number;
    speedMaxMmPerSec: number;
  };
  parcel: {
    widthMm: number;
    heightMm: number;
    lengthMm: number;
    /** Front-to-front spawn interval in ms (PAR-001). */
    spawnIntervalMs: number;
    labelCountMin: number;
    labelCountMax: number;
    material: MaterialPreset;
    lateralOffsetMm: number;
    yawDeg: number;
  };
  station: {
    lengthMm: number;
    /** Distance after exit to the sort point; capped by sortDistanceMaxMm. */
    sortDistanceMm: number;
    sortDistanceMaxMm: number;
    bottomTransfer: 'SIDE_GRIP' | 'GAP';
  };
  cameras: {
    count: number;
    sensorWidthPx: number;
    sensorHeightPx: number;
    previewMaxWidthPx: number;
    previewMaxHeightPx: number;
    focalLengthMm: number;
    exposureUs: number;
    fps: number;
    shutter: 'GLOBAL' | 'ROLLING';
  };
  barcode: {
    symbology: 'CODE128';
    labelWidthMm: number;
    labelHeightMm: number;
    /** Explicit test assumption, not a physical fact (REV-03). */
    xDimensionMm: number;
    /** `KTY-` + 14 ASCII digits. */
    payloadPrefix: string;
    payloadDigits: number;
  };
  /**
   * Editable quality-model thresholds (§8). Every value is a labelled
   * simulation assumption, not a physical constant.
   */
  quality: QualityThresholds;
  /** Grace period after the exit event before finalization (PIPE-009). */
  finalizeGraceMs: number;
  frameBufferMaxPerCamera: number;
}

export function defaultConfig(): SimConfig {
  return {
    version: CONFIG_VERSION,
    seed: 2026,
    belt: {
      widthMm: 650,
      speedMmPerSec: 1000,
      speedMinMmPerSec: 0,
      speedMaxMmPerSec: 1500,
    },
    parcel: {
      widthMm: 400,
      heightMm: 400,
      lengthMm: 600,
      spawnIntervalMs: 2000,
      labelCountMin: 1,
      labelCountMax: 4,
      material: 'KRAFT',
      lateralOffsetMm: 0,
      yawDeg: 0,
    },
    station: {
      lengthMm: 2200,
      sortDistanceMm: 1250,
      sortDistanceMaxMm: 3000,
      bottomTransfer: 'SIDE_GRIP',
    },
    cameras: {
      count: 6,
      sensorWidthPx: 5320,
      sensorHeightPx: 3032,
      previewMaxWidthPx: 960,
      previewMaxHeightPx: 540,
      focalLengthMm: 16,
      exposureUs: 75,
      fps: 20,
      shutter: 'GLOBAL',
    },
    barcode: {
      symbology: 'CODE128',
      labelWidthMm: 78,
      labelHeightMm: 25,
      xDimensionMm: 0.3,
      payloadPrefix: 'KTY-',
      payloadDigits: 14,
    },
    quality: {
      coverageMin: 0.92,
      ppmMin: 2.0,
      ppmTarget: 3.0,
      blurPxMax: 1.0,
      blurPxTarget: 0.5,
      incidenceDegMax: 60,
      incidenceDegTarget: 35,
      boundaryBand: 0.15,
    },
    finalizeGraceMs: 250,
    frameBufferMaxPerCamera: 120,
  };
}

export type ConfigError = { path: string; message: string };

/**
 * Validate a config (used by presets and by JSON import, CFG-001/CFG-007).
 * Returns a list of problems; empty list means valid.
 */
export function validateConfig(cfg: SimConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const num = (v: unknown, path: string, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push({ path, message: 'must be a finite number' });
    } else if (v < min || v > max) {
      errors.push({ path, message: `must be within [${min}, ${max}]` });
    }
  };

  if (cfg.version !== CONFIG_VERSION) {
    errors.push({
      path: 'version',
      message: `unsupported config version ${cfg.version} (expected ${CONFIG_VERSION})`,
    });
  }
  num(cfg.belt.widthMm, 'belt.widthMm', 100, 3000);
  num(cfg.belt.speedMmPerSec, 'belt.speedMmPerSec', 0, 1500);
  num(cfg.parcel.widthMm, 'parcel.widthMm', 50, 640);
  num(cfg.parcel.heightMm, 'parcel.heightMm', 50, 640);
  num(cfg.parcel.lengthMm, 'parcel.lengthMm', 50, 2000);
  num(cfg.parcel.spawnIntervalMs, 'parcel.spawnIntervalMs', 100, 60000);
  if (cfg.parcel.labelCountMin < 1 || cfg.parcel.labelCountMin > cfg.parcel.labelCountMax) {
    errors.push({
      path: 'parcel.labelCountMin',
      message: 'must be >= 1 and <= labelCountMax',
    });
  }
  num(cfg.station.lengthMm, 'station.lengthMm', 500, 10000);
  num(cfg.station.sortDistanceMm, 'station.sortDistanceMm', 0, 3000);
  if (cfg.station.sortDistanceMm > cfg.station.sortDistanceMaxMm) {
    errors.push({
      path: 'station.sortDistanceMm',
      message: 'must not exceed sortDistanceMaxMm (3000 mm per plan §4)',
    });
  }
  num(cfg.cameras.focalLengthMm, 'cameras.focalLengthMm', 2, 120);
  num(cfg.cameras.exposureUs, 'cameras.exposureUs', 1, 50000);
  num(cfg.cameras.fps, 'cameras.fps', 1, 120);
  num(cfg.barcode.xDimensionMm, 'barcode.xDimensionMm', 0.05, 2);
  num(cfg.quality.coverageMin, 'quality.coverageMin', 0, 1);
  num(cfg.quality.ppmMin, 'quality.ppmMin', 0.5, 10);
  num(cfg.quality.blurPxMax, 'quality.blurPxMax', 0.05, 10);
  num(cfg.quality.incidenceDegMax, 'quality.incidenceDegMax', 10, 90);
  num(cfg.finalizeGraceMs, 'finalizeGraceMs', 0, 10000);

  return errors;
}

/** A camera preset matching the proposed 16 MP industrial-reader concept (REV-06). */
export function industrialReaderCameraPreset(
  id: string,
  role: CameraConfig['role'],
  positionMm: [number, number, number],
  quaternion: [number, number, number, number],
): CameraConfig {
  return {
    id,
    name: `${role} industrial reader`,
    role,
    pose: { positionMm, quaternion },
    sensor: {
      widthPx: 5320,
      heightPx: 3032,
      focalLengthMm: 16,
      filmGaugeMm: 23.5,
      nearMm: 50,
      farMm: 8000,
    },
    acquisition: {
      fps: 20,
      exposureUs: 75,
      gainDb: 0,
      shutter: 'GLOBAL',
      focusDistanceMm: 850,
      rollingReadoutUs: 30000,
    },
    illumination: {
      intensity: 1.0,
      polarized: true,
      strobeUs: 75,
      ambientLeak: 0.05,
    },
    optics: {
      apertureProxy: 4.0,
      radialDistortion: [0, 0],
      vignetting: 0,
    },
    imageEffects: {
      motionBlur: 'DIRECTIONAL',
      temporalSamples: 8,
      shotNoise: 0.15,
      readNoise: 0.05,
      compression: 0,
      artifactAmplification: 1,
    },
    preview: { widthPx: 960, heightPx: 540, overlay: true },
    enabled: true,
  };
}

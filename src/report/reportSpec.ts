/**
 * Final-report parameter specification (Phase 0 of REPORT_ALIGNMENT_PLAN.md).
 *
 * The final LaTeX report for the conveyor barcode-reading station is the
 * source of truth for the `report-8reader` preset. This module freezes every
 * numerical value the report states, with units, plus the report's derived
 * calculations as pure functions. It contains NO UI, scene, or simulation
 * logic — only data and math.
 *
 * Values marked "labelled engineering assumption" are interpretations of the
 * report's qualitative statements (e.g. "working distance 1400–1500 mm" →
 * 1450 mm preset); they are recorded here, not invented inside preset
 * builders.
 *
 * World conventions (shared with the rest of the project):
 *  - Belt top at y = 0, travel along +z, station spans z ∈ [0, lengthMm].
 *  - x is lateral (across the belt), y is up.
 *  - Angles measured in the horizontal plane from +z (travel) toward +x.
 */

// ---------------------------------------------------------------------------
// Barcode (report §barcode)

export const REPORT_BARCODE = {
  symbology: 'CODE128' as const,
  /** Barcode module width (x dimension), mm. */
  xDimensionMm: 0.35,
} as const;

// ---------------------------------------------------------------------------
// Side area cameras (report §6 side readers)

export const REPORT_SIDE = {
  /** Six side area cameras: three per conveyor side. */
  cameraCount: 6,
  camerasPerConveyorSide: 3,
  /** Adjacent viewing directions differ by 60°. */
  directionSpacingDeg: 60,
  /** Worst-case incidence for a centred parcel: half the spacing. */
  worstCaseIncidenceDeg: 30,
  /** Sensor resolution, px (about 8000×4500 in the report). */
  sensorWidthPx: 8000,
  sensorHeightPx: 4500,
  /** Pixel pitch, mm (4.5 µm → 36.0 × 20.25 mm imager). */
  pixelPitchMm: 0.0045,
  filmGaugeWidthMm: 36.0,
  filmGaugeHeightMm: 20.25,
  /** Lens focal length, mm (report: about 50–60 mm). */
  focalLengthMm: 55,
  /** Working distance range, mm (report: 1400–1500 mm). */
  workingDistanceMinMm: 1400,
  workingDistanceMaxMm: 1500,
  /** Preset working distance / mount radius, mm (labelled assumption:
   *  midpoint of the report range). */
  workingDistanceMm: 1450,
  /** Acquisition range (report: 20–30 FPS, global shutter). */
  fpsMin: 20,
  fpsMax: 30,
  fpsPreset: 25,
  /** Exposure range, µs (report: 50–100 µs, global shutter). */
  exposureUsMin: 50,
  exposureUsMax: 100,
  exposureUsPreset: 75,
  shutter: 'GLOBAL' as const,
} as const;

/**
 * Mount directions of the six side cameras, degrees in the horizontal
 * plane measured from +z (travel) toward +x, with direction vector
 * (sin α, 0, cos α). 60° apart; three on the +x side (30°, 90°, 150°)
 * and three on the −x side (210°, 270°, 330°). All aim at the parcel
 * centre.
 */
export const REPORT_SIDE_MOUNT_ANGLES_DEG: readonly number[] = [
  30, 90, 150, 210, 270, 330,
];

export interface SideMount {
  /** Camera index 0..5 (order of REPORT_SIDE_MOUNT_ANGLES_DEG). */
  index: number;
  /** Direction angle from +z toward +x, degrees. */
  angleDeg: number;
  /** Exact world position, mm (labelled engineering interpretation of the
   *  report's 60°/WD description). */
  positionMm: [number, number, number];
  /** Look target, mm (parcel centre at the station centre). */
  targetMm: [number, number, number];
}

/**
 * Exact world coordinate table for the six side readers (report §6),
 * derived from the mount angles and the working distance for the default
 * station (2200 mm) and parcel (400 mm tall). This table — not the preset
 * builder — is the geometric contract the tests verify against.
 */
export function reportSideMounts(
  stationLengthMm: number,
  parcelHeightMm: number,
  mountRadiusMm: number = REPORT_SIDE.workingDistanceMm,
): SideMount[] {
  const centre: [number, number, number] = [
    0,
    parcelHeightMm / 2,
    stationLengthMm / 2,
  ];
  return REPORT_SIDE_MOUNT_ANGLES_DEG.map((angleDeg, index) => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      index,
      angleDeg,
      positionMm: [
        mountRadiusMm * Math.sin(rad),
        centre[1],
        centre[2] + mountRadiusMm * Math.cos(rad),
      ],
      targetMm: centre,
    };
  });
}

/** The table for the default 2200 mm station / 400 mm parcel. */
export const REPORT_SIDE_MOUNTS: readonly SideMount[] =
  reportSideMounts(2200, 400);

// ---------------------------------------------------------------------------
// Top/bottom line scanners (report §7)

export const REPORT_LINE = {
  /** Two line scanners: one top, one bottom. */
  sensorCount: 2,
  /** Pixels across the belt per line. */
  pixelsPerLine: 8192,
  /** Physical line-sensor pixel pitch, mm (5 µm). */
  physicalPixelPitchMm: 0.005,
  /** Physical line-sensor width, mm (8192 × 5 µm = 40.96). */
  physicalSensorWidthMm: 40.96,
  /** Object-space field of view across the belt at the scan plane, mm. */
  fovWidthMm: 715,
  /** Encoder travel per acquired line, mm. */
  encoderStepMmPerLine: 0.1,
  /** Largest step that keeps ≥ 3 travel lines per 0.35 mm module
   *  (0.35 / 3 ≈ 0.117 mm). */
  maxEncoderStepMmPerLine: 0.117,
  /** Minimum sustained line rate for the operating speed band, lines/s. */
  minLineRateLinesPerSec: 10000,
  /** Hardware ceiling (preset), lines/s (report: at least 10 kHz;
   *  12 kHz keeps 1 m/s under the limit). */
  maxLineRateLinesPerSec: 12000,
  /** Scan-plane margin beyond the belt, mm (715 − 650). */
  fovMarginMm: 65,
  /** Top scanner working distance above the parcel top face, mm
   *  (labelled engineering assumption). */
  topWorkingDistanceMm: 150,
  /** Bottom optical gap between the belt and the bottom scan plane, mm
   *  (report: 100 mm). */
  bottomGapMm: 100,
} as const;

// ---------------------------------------------------------------------------
// Station / parcel defaults referenced by the report calculations

export const REPORT_STATION = {
  /** Belt width, mm. */
  beltWidthMm: 650,
  /** Operating belt speed, mm/s (1 m/s). */
  speedMmPerSec: 1000,
  /** Maximum belt speed, mm/s (1.5 m/s — saturates the line rate). */
  speedMaxMmPerSec: 1500,
  /** Default parcel envelope, mm. */
  parcelWidthMm: 400,
  parcelHeightMm: 400,
  parcelLengthMm: 600,
  /** Station length, mm. */
  stationLengthMm: 2200,
} as const;

/**
 * Allowed lateral parcel range set by the upstream centreing guides
 * (report: the guides keep the parcel centred on the belt): half the
 * free belt on each side = (belt − parcel) / 2. 650 mm belt / 400 mm
 * parcel → 125 mm.
 */
export function guideLateralRangeMm(beltWidthMm: number, parcelWidthMm: number): number {
  return (beltWidthMm - parcelWidthMm) / 2;
}

// ---------------------------------------------------------------------------
// Derived calculations (the report's math, as pure functions)

/** Worst-case incidence for a ring of equally spaced viewing directions. */
export function worstCaseIncidenceDeg(directionSpacingDeg: number): number {
  return directionSpacingDeg / 2;
}

/** Pinhole magnification m = f / (WD − f) (object closer than focus-free
 *  approximation; WD >> f here). */
export function sideMagnification(focalLengthMm: number, workingDistanceMm: number): number {
  return focalLengthMm / (workingDistanceMm - focalLengthMm);
}

/**
 * Object-space pixel pitch of a side reader at the working distance, mm/px:
 * pixel pitch on the sensor divided by magnification.
 * 4.5 µm / (55/1395) ≈ 0.1141 mm/px.
 */
export function sideObjectMmPerPixel(
  focalLengthMm: number,
  pixelPitchMm: number,
  workingDistanceMm: number,
): number {
  return pixelPitchMm * (workingDistanceMm - focalLengthMm) / focalLengthMm;
}

/**
 * Projected pixels per barcode module at an incidence angle:
 * module / (object pitch) / cos(incidence).
 */
export function sidePixelsPerModule(
  xDimensionMm: number,
  focalLengthMm: number,
  pixelPitchMm: number,
  workingDistanceMm: number,
  incidenceDeg = 0,
): number {
  const objectMmPx = sideObjectMmPerPixel(focalLengthMm, pixelPitchMm, workingDistanceMm);
  const rad = (incidenceDeg * Math.PI) / 180;
  return xDimensionMm / objectMmPx / Math.cos(rad);
}

/**
 * Object-space field width visible at a plane `distMm` from the lens, mm:
 * width = dist × sensor width / focal (exact pinhole).
 * 1450 × 36 / 55 ≈ 949 mm.
 */
export function sideFovWidthMm(
  focalLengthMm: number,
  filmGaugeWidthMm: number,
  distMm: number,
): number {
  return (distMm * filmGaugeWidthMm) / focalLengthMm;
}

/** Focal length that yields a given field width at a distance (inverse of
 *  sideFovWidthMm) — the report's focal-length sizing example. */
export function focalLengthForFovWidthMm(
  fovWidthMm: number,
  filmGaugeWidthMm: number,
  distMm: number,
): number {
  return (distMm * filmGaugeWidthMm) / fovWidthMm;
}

/** Object-space width covered by one line-scan pixel, mm: FOV / pixels.
 *  715 / 8192 ≈ 0.0873 mm/px. */
export function lineMmPerPixel(fovWidthMm: number, pixelsPerLine: number): number {
  return fovWidthMm / pixelsPerLine;
}

/** Pixels per barcode module across the belt (cross-belt ppm). */
export function lineCrossBeltPpm(
  xDimensionMm: number,
  fovWidthMm: number,
  pixelsPerLine: number,
): number {
  return (xDimensionMm * pixelsPerLine) / fovWidthMm;
}

/** Travel lines per barcode module (along-travel ppm). */
export function lineTravelPpm(xDimensionMm: number, encoderStepMmPerLine: number): number {
  return xDimensionMm / encoderStepMmPerLine;
}

/** Effective line ppm: the bottleneck axis (min of cross-belt and travel). */
export function lineEffectivePpm(
  xDimensionMm: number,
  fovWidthMm: number,
  pixelsPerLine: number,
  encoderStepMmPerLine: number,
): number {
  return Math.min(
    lineCrossBeltPpm(xDimensionMm, fovWidthMm, pixelsPerLine),
    lineTravelPpm(xDimensionMm, encoderStepMmPerLine),
  );
}

/**
 * Minimum pixels per line so a module spans at least `minPpm` pixels across
 * the belt: ceil(FOV × minPpm / module). 715 × 2 / 0.35 → 4086 px.
 */
export function lineMinPixelsPerLine(
  fovWidthMm: number,
  xDimensionMm: number,
  minPpm: number,
): number {
  return Math.ceil((fovWidthMm * minPpm) / xDimensionMm);
}

/** Required line rate (lines/s) for a belt speed. 1 m/s / 0.1 mm → 10 000. */
export function requiredLineRate(
  velocityMmPerSec: number,
  encoderStepMmPerLine: number,
): number {
  return velocityMmPerSec / encoderStepMmPerLine;
}

/** Largest encoder step that keeps ≥ `minPpm` travel lines per module:
 *  module / minPpm. 0.35 / 3 ≈ 0.117 mm. */
export function maxEncoderStepForPpm(xDimensionMm: number, minPpm: number): number {
  return xDimensionMm / minPpm;
}

/** True when the line FOV covers the belt plus the report margin.
 *  715 ≥ 650 + 65. */
export function lineFovCoversBelt(
  fovWidthMm: number,
  beltWidthMm: number,
  marginMm: number,
): boolean {
  return fovWidthMm >= beltWidthMm + marginMm;
}

/**
 * Blur in line pixels during one line exposure (belt travel along the strip
 * axis): speed × exposure / object pixel pitch.
 * 1000 mm/s × 75 µs / 0.0873 ≈ 0.86 px.
 */
export function lineBlurPx(
  velocityMmPerSec: number,
  exposureUs: number,
  fovWidthMm: number,
  pixelsPerLine: number,
): number {
  return (velocityMmPerSec * (exposureUs / 1e6)) / lineMmPerPixel(fovWidthMm, pixelsPerLine);
}

/**
 * Blur in side-camera pixels during one exposure (belt travel projected
 * onto the sensor): speed × exposure / object-space pixel pitch.
 * 1000 mm/s × 75 µs / 0.1141 ≈ 0.66 px.
 */
export function sideBlurPx(
  velocityMmPerSec: number,
  exposureUs: number,
  focalLengthMm: number,
  pixelPitchMm: number,
  workingDistanceMm: number,
): number {
  return (
    (velocityMmPerSec * (exposureUs / 1e6)) /
    sideObjectMmPerPixel(focalLengthMm, pixelPitchMm, workingDistanceMm)
  );
}

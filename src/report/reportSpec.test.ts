/**
 * Phase 0 tests: every calculation in the final report (reportSpec.ts).
 * No values are imported from the legacy draft preset or Report Draft.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_BARCODE,
  REPORT_LINE,
  REPORT_SIDE,
  REPORT_SIDE_MOUNTS,
  REPORT_STATION,
  focalLengthForFovWidthMm,
  lineBlurPx,
  lineCrossBeltPpm,
  lineEffectivePpm,
  lineFovCoversBelt,
  lineMmPerPixel,
  lineMinPixelsPerLine,
  lineTravelPpm,
  maxEncoderStepForPpm,
  REPORT_SIDE_MOUNT_ANGLES_DEG,
  reportSideMounts,
  requiredLineRate,
  sideBlurPx,
  sideFovWidthMm,
  sideMagnification,
  sideObjectMmPerPixel,
  sidePixelsPerModule,
  worstCaseIncidenceDeg,
} from './reportSpec';

const S = REPORT_SIDE;
const L = REPORT_LINE;
const ST = REPORT_STATION;

describe('report contract: constants', () => {
  it('uses the report module size 0.35 mm', () => {
    expect(REPORT_BARCODE.xDimensionMm).toBe(0.35);
  });

  it('uses the report side sensor 8000×4500', () => {
    expect(S.sensorWidthPx).toBe(8000);
    expect(S.sensorHeightPx).toBe(4500);
  });

  it('uses the report side optics: 55 mm lens at 1400–1500 mm WD', () => {
    expect(S.focalLengthMm).toBeGreaterThanOrEqual(50);
    expect(S.focalLengthMm).toBeLessThanOrEqual(60);
    expect(S.focalLengthMm).toBe(55);
    expect(S.workingDistanceMinMm).toBe(1400);
    expect(S.workingDistanceMaxMm).toBe(1500);
    expect(S.workingDistanceMm).toBeGreaterThanOrEqual(1400);
    expect(S.workingDistanceMm).toBeLessThanOrEqual(1500);
  });

  it('uses the report side acquisition band: 20–30 FPS, 50–100 µs, global', () => {
    expect(S.fpsMin).toBe(20);
    expect(S.fpsMax).toBe(30);
    expect(S.fpsPreset).toBeGreaterThanOrEqual(20);
    expect(S.fpsPreset).toBeLessThanOrEqual(30);
    expect(S.exposureUsMin).toBe(50);
    expect(S.exposureUsMax).toBe(100);
    expect(S.exposureUsPreset).toBeGreaterThanOrEqual(50);
    expect(S.exposureUsPreset).toBeLessThanOrEqual(100);
    expect(S.shutter).toBe('GLOBAL');
  });

  it('uses the report line sensor: 8192 px, 40.96 mm physical, 715 mm FOV', () => {
    expect(L.pixelsPerLine).toBe(8192);
    expect(L.physicalSensorWidthMm).toBeCloseTo(40.96, 3);
    expect(L.physicalSensorWidthMm).toBeCloseTo(
      L.pixelsPerLine * L.physicalPixelPitchMm,
      6,
    );
    expect(L.fovWidthMm).toBe(715);
  });

  it('uses the report line sampling: 0.1 mm step (≤0.117), ≥10 kHz, 12 kHz preset', () => {
    expect(L.encoderStepMmPerLine).toBe(0.1);
    expect(L.encoderStepMmPerLine).toBeLessThanOrEqual(L.maxEncoderStepMmPerLine);
    expect(L.minLineRateLinesPerSec).toBeGreaterThanOrEqual(8500);
    expect(L.maxLineRateLinesPerSec).toBeGreaterThanOrEqual(10000);
    expect(L.maxLineRateLinesPerSec).toBe(12000);
  });

  it('keeps the 100 mm bottom gap and 65 mm line-FOV margin', () => {
    expect(L.bottomGapMm).toBe(100);
    expect(L.fovMarginMm).toBe(L.fovWidthMm - ST.beltWidthMm);
    expect(ST.beltWidthMm).toBe(650);
  });
});

describe('report contract: side-camera calculations', () => {
  it('worst-case incidence is 30° for 60° spacing', () => {
    expect(worstCaseIncidenceDeg(S.directionSpacingDeg)).toBe(30);
  });

  it('magnification at 55 mm / 1450 mm is 55/1395', () => {
    expect(sideMagnification(55, 1450)).toBeCloseTo(55 / 1395, 9);
  });

  it('object-space pixel pitch is ≈ 0.1141 mm/px (the report max mm/px)', () => {
    expect(
      sideObjectMmPerPixel(S.focalLengthMm, S.pixelPitchMm, S.workingDistanceMm),
    ).toBeCloseTo(0.1141, 3);
  });

  it('side resolution: 0.35 mm module ≥ 2 px/module at 0° and at 30°', () => {
    const at0 = sidePixelsPerModule(
      REPORT_BARCODE.xDimensionMm,
      S.focalLengthMm,
      S.pixelPitchMm,
      S.workingDistanceMm,
      0,
    );
    const at30 = sidePixelsPerModule(
      REPORT_BARCODE.xDimensionMm,
      S.focalLengthMm,
      S.pixelPitchMm,
      S.workingDistanceMm,
      30,
    );
    expect(at0).toBeCloseTo(3.066, 2);
    expect(at30).toBeCloseTo(3.541, 2);
    expect(at0).toBeGreaterThan(2);
    expect(at30).toBeGreaterThan(2);
  });

  it('side diagonal FOV: 55 mm / 36 mm covers ≈ 949 mm at 1450 mm', () => {
    expect(sideFovWidthMm(S.focalLengthMm, S.filmGaugeWidthMm, 1450)).toBeCloseTo(949.09, 1);
  });

  it('focal-length example: 80.3 mm focuses a 650 mm field at 1450 mm', () => {
    expect(focalLengthForFovWidthMm(650, 36, 1450)).toBeCloseTo(80.31, 1);
  });

  it('side exposure ceiling: 75 µs at 1 m/s blurs < 1 px', () => {
    expect(
      sideBlurPx(
        ST.speedMmPerSec,
        S.exposureUsPreset,
        S.focalLengthMm,
        S.pixelPitchMm,
        S.workingDistanceMm,
      ),
    ).toBeCloseTo(0.657, 2);
    expect(
      sideBlurPx(
        ST.speedMmPerSec,
        S.exposureUsMax,
        S.focalLengthMm,
        S.pixelPitchMm,
        S.workingDistanceMm,
      ),
    ).toBeLessThan(1);
  });
});

describe('report contract: line-scan calculations', () => {
  it('line mm/px = 715/8192 ≈ 0.0873', () => {
    expect(lineMmPerPixel(L.fovWidthMm, L.pixelsPerLine)).toBeCloseTo(0.08728, 4);
  });

  it('cross-belt ppm ≈ 4.01 and travel ppm = 3.5 for the 0.35 mm module', () => {
    expect(lineCrossBeltPpm(0.35, L.fovWidthMm, L.pixelsPerLine)).toBeCloseTo(4.01, 2);
    expect(lineTravelPpm(0.35, L.encoderStepMmPerLine)).toBeCloseTo(3.5, 9);
    expect(
      lineEffectivePpm(0.35, L.fovWidthMm, L.pixelsPerLine, L.encoderStepMmPerLine),
    ).toBeCloseTo(3.5, 9);
  });

  it('minimum pixels per line for 2 ppm is 4086', () => {
    expect(lineMinPixelsPerLine(L.fovWidthMm, 0.35, 2)).toBe(4086);
    expect(L.pixelsPerLine).toBeGreaterThanOrEqual(lineMinPixelsPerLine(L.fovWidthMm, 0.35, 2));
  });

  it('line rate: 10 000 lines/s at 1 m/s (under the 12 000 ceiling)', () => {
    expect(requiredLineRate(ST.speedMmPerSec, L.encoderStepMmPerLine)).toBe(10000);
    expect(requiredLineRate(ST.speedMmPerSec, L.encoderStepMmPerLine)).toBeLessThan(
      L.maxLineRateLinesPerSec,
    );
  });

  it('line rate: 15 000 lines/s at 1.5 m/s exceeds the ceiling (undersampling)', () => {
    expect(requiredLineRate(ST.speedMaxMmPerSec, L.encoderStepMmPerLine)).toBe(15000);
    expect(requiredLineRate(ST.speedMaxMmPerSec, L.encoderStepMmPerLine)).toBeGreaterThan(
      L.maxLineRateLinesPerSec,
    );
  });

  it('max encoder step for ≥3 travel ppm is 0.35/3 ≈ 0.117 mm', () => {
    expect(maxEncoderStepForPpm(0.35, 3)).toBeCloseTo(0.1167, 3);
    expect(maxEncoderStepForPpm(0.35, 3)).toBeLessThanOrEqual(L.maxEncoderStepMmPerLine);
  });

  it('715 mm FOV covers the 650 mm belt plus the 65 mm margin', () => {
    expect(lineFovCoversBelt(L.fovWidthMm, ST.beltWidthMm, L.fovMarginMm)).toBe(true);
    expect(lineFovCoversBelt(714, ST.beltWidthMm, L.fovMarginMm)).toBe(false);
  });

  it('line exposure blur at 75 µs / 1 m/s is < 1 line pixel', () => {
    expect(lineBlurPx(ST.speedMmPerSec, 75, L.fovWidthMm, L.pixelsPerLine)).toBeCloseTo(
      0.859,
      2,
    );
  });
});

describe('report contract: six side-reader mount table', () => {
  const near = (got: [number, number, number], want: [number, number, number]) => {
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 3));
  };

  it('has exactly six mounts, 60° apart, three per lateral side', () => {
    expect(REPORT_SIDE_MOUNTS).toHaveLength(6);
    const angles = [...REPORT_SIDE_MOUNT_ANGLES_DEG].sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBe(60);
    }
    const pos = REPORT_SIDE_MOUNTS.map((m) => m.positionMm[0]);
    expect(pos.filter((x) => x > 0)).toHaveLength(3);
    expect(pos.filter((x) => x < 0)).toHaveLength(3);
  });

  it('lists the exact default positions and shared aim target', () => {
    const m = REPORT_SIDE_MOUNTS;
    near(m[0].positionMm, [725, 200, 2355.737]);
    near(m[1].positionMm, [1450, 200, 1100]);
    near(m[2].positionMm, [725, 200, -155.737]);
    near(m[3].positionMm, [-725, 200, -155.737]);
    near(m[4].positionMm, [-1450, 200, 1100]);
    near(m[5].positionMm, [-725, 200, 2355.737]);
    for (const mount of m) {
      expect(mount.targetMm).toEqual([0, 200, 1100]);
    }
  });

  it('re-derives the table for non-default stations', () => {
    const m = reportSideMounts(1000, 300, 1000);
    near(m[1].positionMm, [1000, 150, 500]);
    expect(m[1].targetMm).toEqual([0, 150, 500]);
  });
});

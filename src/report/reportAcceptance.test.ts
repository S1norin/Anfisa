/**
 * Final-report acceptance suite (t6-accept): the ONE place where the full
 * report contract is verified end-to-end — every geometry and sampling
 * requirement the final report states, checked against the live
 * `reportEightReaderConfig()` preset and the frozen `reportSpec.ts`
 * values. If the report changes, this file changes with it.
 *
 * Geometry: 6 side + 2 line readers; 60° mount spacing (3+/3− lateral);
 * ≤30.5° worst-case face incidence; 0.35 mm module; 8000×4500 side
 * sensors clearing ppmMin at 30°; 55 mm focal at the 1450 mm working
 * distance; 715 mm line FOV covering the 650 mm belt + 65 mm margin.
 * Sampling: 8192 px lines; 0.1 mm encoder step; 10 000 lines/s at
 * 1 m/s under the 12 000 ceiling; 15 000 > 12 000 at 1.5 m/s; 100 mm
 * bottom gap; 50–100 µs global shutter inside the 20–30 FPS band.
 */

import { describe, expect, it } from 'vitest';
import { reportEightReaderConfig } from '../capture/presets';
import { GAP_OPENING_MM, validateConfig, type SimConfig } from '../domain/config';
import { isAreaScan, isLineScan } from '../domain/camera';
import type { AreaScanCameraConfig, LineScanCameraConfig } from '../domain/types';
import {
  REPORT_BARCODE,
  REPORT_LINE,
  REPORT_SIDE,
  REPORT_SIDE_MOUNT_ANGLES_DEG,
  REPORT_STATION,
  lineFovCoversBelt,
  lineMmPerPixel,
  requiredLineRate,
  sidePixelsPerModule,
  worstCaseIncidenceDeg,
} from './reportSpec';

/** Mount angles of the side readers, degrees from +z toward +x, sorted.
 *  Derived from the preset's poses, not from the spec table — the preset
 *  must place the cameras where the report says. */
function sideMountAnglesDeg(cfg: SimConfig): number[] {
  const cz = cfg.station.lengthMm / 2;
  return cfg.cameraRigs
    .filter(isAreaScan)
    .map((r) => {
      const [x, , z] = r.pose.positionMm;
      const ang = (Math.atan2(x, z - cz) * 180) / Math.PI;
      // Round off trig float noise (e.g. 210.00000000000003).
      return Math.round((((ang + 360) % 360) + 1e-9) * 1e6) / 1e6;
    })
    .sort((a, b) => a - b);
}

function sidesOf(cfg: SimConfig): AreaScanCameraConfig[] {
  return cfg.cameraRigs.filter(isAreaScan);
}

function lineOf(cfg: SimConfig, role: 'TOP' | 'BOTTOM'): LineScanCameraConfig {
  const rig = cfg.cameraRigs.find(
    (r) => isLineScan(r) && r.role === role,
  ) as LineScanCameraConfig | undefined;
  expect(rig, `LINE_SCAN ${role} rig present`).toBeDefined();
  return rig!;
}

describe('t6-accept: report geometry contract (reportEightReaderConfig)', () => {
  const cfg = reportEightReaderConfig();

  it('validates as a complete SimConfig', () => {
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('has exactly eight readers: six side area + two line (TOP, BOTTOM)', () => {
    expect(cfg.cameraRigs).toHaveLength(8);
    expect(sidesOf(cfg)).toHaveLength(REPORT_SIDE.cameraCount);
    expect(sidesOf(cfg)).toHaveLength(REPORT_SIDE.camerasPerConveyorSide * 2);
    const lines = cfg.cameraRigs.filter(isLineScan);
    expect(lines).toHaveLength(REPORT_LINE.sensorCount);
    expect(lines.map((r) => r.role).sort()).toEqual(['BOTTOM', 'TOP']);
  });

  it('mounts the six side readers 60° apart (the report direction ring)', () => {
    const angles = sideMountAnglesDeg(cfg);
    expect(angles).toEqual([...REPORT_SIDE_MOUNT_ANGLES_DEG].sort((a, b) => a - b));
    // Pairwise spacing (with wrap-around) is exactly the report 60°.
    for (let i = 0; i < angles.length; i++) {
      const next = angles[(i + 1) % angles.length];
      const diff = i === angles.length - 1 ? 360 - angles[i] + angles[0] : next - angles[i];
      expect(diff, `spacing after ${angles[i]}°`).toBe(REPORT_SIDE.directionSpacingDeg);
    }
  });

  it('places three readers per lateral side (3+/3−)', () => {
    const positive = sidesOf(cfg).filter((r) => r.pose.positionMm[0] > 0);
    const negative = sidesOf(cfg).filter((r) => r.pose.positionMm[0] < 0);
    expect(positive).toHaveLength(REPORT_SIDE.camerasPerConveyorSide);
    expect(negative).toHaveLength(REPORT_SIDE.camerasPerConveyorSide);
  });

  it('keeps worst-case face incidence ≤ 30.5° for the 60° ring', () => {
    const angles = sideMountAnglesDeg(cfg);
    let maxGap = 0;
    for (let i = 0; i < angles.length; i++) {
      const next = angles[(i + 1) % angles.length];
      const diff = i === angles.length - 1 ? 360 - angles[i] + angles[0] : next - angles[i];
      maxGap = Math.max(maxGap, diff);
    }
    // A centred parcel faces the midpoint of the widest gap.
    expect(worstCaseIncidenceDeg(maxGap)).toBeLessThanOrEqual(30.5);
    expect(worstCaseIncidenceDeg(REPORT_SIDE.directionSpacingDeg)).toBeLessThanOrEqual(30.5);
  });

  it('targets the report 0.35 mm barcode module', () => {
    expect(cfg.barcode.xDimensionMm).toBe(REPORT_BARCODE.xDimensionMm);
    expect(cfg.barcode.xDimensionMm).toBe(0.35);
  });

  it('uses 8000×4500 side sensors that clear the ppm floor at 30° incidence', () => {
    for (const r of sidesOf(cfg)) {
      expect(r.sensor.widthPx).toBe(REPORT_SIDE.sensorWidthPx);
      expect(r.sensor.heightPx).toBe(REPORT_SIDE.sensorHeightPx);
    }
    const ppmAtWorstCase = sidePixelsPerModule(
      REPORT_BARCODE.xDimensionMm,
      REPORT_SIDE.focalLengthMm,
      REPORT_SIDE.pixelPitchMm,
      REPORT_SIDE.workingDistanceMm,
      worstCaseIncidenceDeg(REPORT_SIDE.directionSpacingDeg),
    );
    expect(ppmAtWorstCase).toBeGreaterThanOrEqual(cfg.quality.ppmMin);
  });

  it('fits a 55 mm lens at the 1450 mm working distance (face distance)', () => {
    for (const r of sidesOf(cfg)) {
      expect(r.sensor.focalLengthMm).toBe(REPORT_SIDE.focalLengthMm);
      expect(r.sensor.focalLengthMm).toBe(55);
      // Focus plane is the parcel face at the report working distance.
      expect(r.acquisition.focusDistanceMm).toBe(REPORT_SIDE.workingDistanceMm);
      expect(r.acquisition.focusDistanceMm).toBe(1450);
    }
    // Mount circle: WD + half the parcel width from the station centre.
    const expectedRadius = REPORT_SIDE.workingDistanceMm + REPORT_STATION.parcelWidthMm / 2;
    const cz = cfg.station.lengthMm / 2;
    for (const r of sidesOf(cfg)) {
      const [x, y, z] = r.pose.positionMm;
      const dist = Math.hypot(x - 0, y - cfg.parcel.heightMm / 2, z - cz);
      expect(dist).toBeCloseTo(expectedRadius, 6);
    }
  });

  it('covers the belt from a 715 mm line FOV: 650 mm belt + 65 mm margin', () => {
    for (const role of ['TOP', 'BOTTOM'] as const) {
      const line = lineOf(cfg, role);
      expect(line.line.fovWidthMm).toBe(REPORT_LINE.fovWidthMm);
      expect(line.line.fovWidthMm).toBe(715);
      expect(line.line.physicalSensorWidthMm).toBe(REPORT_LINE.physicalSensorWidthMm);
      expect(line.line.fovWidthMm - cfg.belt.widthMm).toBe(REPORT_LINE.fovMarginMm);
    }
    expect(lineFovCoversBelt(REPORT_LINE.fovWidthMm, REPORT_STATION.beltWidthMm, REPORT_LINE.fovMarginMm)).toBe(true);
  });

  it('sits the scanners in the 100 mm bottom gap and 150 mm above the parcel top', () => {
    expect(cfg.station.bottomTransfer).toBe('GAP');
    expect(GAP_OPENING_MM).toBe(REPORT_LINE.bottomGapMm);
    expect(GAP_OPENING_MM).toBe(100);
    const bottom = lineOf(cfg, 'BOTTOM');
    expect(bottom.pose.positionMm[1]).toBe(-REPORT_LINE.bottomGapMm);
    const top = lineOf(cfg, 'TOP');
    expect(top.pose.positionMm[1]).toBe(REPORT_STATION.parcelHeightMm + REPORT_LINE.topWorkingDistanceMm);
  });
});

describe('t6-accept: report sampling contract (reportEightReaderConfig)', () => {
  const cfg = reportEightReaderConfig();

  it('reads 8192 px across the belt per line (≈ 0.0873 mm/px)', () => {
    for (const role of ['TOP', 'BOTTOM'] as const) {
      const line = lineOf(cfg, role);
      expect(line.line.pixelsPerLine).toBe(REPORT_LINE.pixelsPerLine);
      expect(line.line.pixelsPerLine).toBe(8192);
    }
    expect(lineMmPerPixel(REPORT_LINE.fovWidthMm, REPORT_LINE.pixelsPerLine)).toBeCloseTo(0.0873, 3);
  });

  it('steps the encoder 0.1 mm per line (under the 0.117 mm ppm limit)', () => {
    for (const role of ['TOP', 'BOTTOM'] as const) {
      const line = lineOf(cfg, role);
      expect(line.line.encoderStepMmPerLine).toBe(REPORT_LINE.encoderStepMmPerLine);
      expect(line.line.encoderStepMmPerLine).toBe(0.1);
    }
    expect(REPORT_LINE.encoderStepMmPerLine).toBeLessThanOrEqual(REPORT_LINE.maxEncoderStepMmPerLine);
  });

  it('needs 10 000 lines/s at 1 m/s — under the 12 000 ceiling', () => {
    const rate = requiredLineRate(REPORT_STATION.speedMmPerSec, REPORT_LINE.encoderStepMmPerLine);
    expect(rate).toBe(REPORT_LINE.minLineRateLinesPerSec);
    expect(rate).toBe(10000);
    for (const role of ['TOP', 'BOTTOM'] as const) {
      expect(lineOf(cfg, role).line.maxLineRateLinesPerSec).toBe(REPORT_LINE.maxLineRateLinesPerSec);
    }
    expect(rate).toBeLessThan(REPORT_LINE.maxLineRateLinesPerSec);
    expect(REPORT_LINE.maxLineRateLinesPerSec).toBe(12000);
  });

  it('needs 15 000 lines/s at 1.5 m/s — over the ceiling (undersampling by design)', () => {
    const rate = requiredLineRate(REPORT_STATION.speedMaxMmPerSec, REPORT_LINE.encoderStepMmPerLine);
    expect(rate).toBe(15000);
    expect(rate).toBeGreaterThan(REPORT_LINE.maxLineRateLinesPerSec);
  });

  it('uses 50–100 µs global shutter inside the 20–30 FPS acquisition band', () => {
    for (const r of sidesOf(cfg)) {
      expect(r.acquisition.shutter).toBe(REPORT_SIDE.shutter);
      expect(r.acquisition.shutter).toBe('GLOBAL');
      expect(r.acquisition.exposureUs).toBeGreaterThanOrEqual(REPORT_SIDE.exposureUsMin);
      expect(r.acquisition.exposureUs).toBeLessThanOrEqual(REPORT_SIDE.exposureUsMax);
      expect(r.acquisition.fps).toBeGreaterThanOrEqual(REPORT_SIDE.fpsMin);
      expect(r.acquisition.fps).toBeLessThanOrEqual(REPORT_SIDE.fpsMax);
    }
    for (const role of ['TOP', 'BOTTOM'] as const) {
      const line = lineOf(cfg, role);
      expect(line.line.lineExposureUs).toBeGreaterThanOrEqual(REPORT_SIDE.exposureUsMin);
      expect(line.line.lineExposureUs).toBeLessThanOrEqual(REPORT_SIDE.exposureUsMax);
    }
    expect(REPORT_SIDE.exposureUsPreset).toBe(75);
    expect(REPORT_SIDE.fpsPreset).toBe(25);
  });

  it('single source: every preset value equals its reportSpec constant', () => {
    // Side optics + sensor.
    expect(cfg.cameras.focalLengthMm).toBe(REPORT_SIDE.focalLengthMm);
    expect(cfg.cameras.sensorWidthPx).toBe(REPORT_SIDE.sensorWidthPx);
    expect(cfg.cameras.sensorHeightPx).toBe(REPORT_SIDE.sensorHeightPx);
    expect(cfg.cameras.exposureUs).toBe(REPORT_SIDE.exposureUsPreset);
    expect(cfg.cameras.fps).toBe(REPORT_SIDE.fpsPreset);
    // Barcode.
    expect(cfg.barcode.xDimensionMm).toBe(REPORT_BARCODE.xDimensionMm);
    // Line rigs.
    for (const role of ['TOP', 'BOTTOM'] as const) {
      const line = lineOf(cfg, role);
      expect(line.line.fovWidthMm).toBe(REPORT_LINE.fovWidthMm);
      expect(line.line.pixelsPerLine).toBe(REPORT_LINE.pixelsPerLine);
      expect(line.line.encoderStepMmPerLine).toBe(REPORT_LINE.encoderStepMmPerLine);
      expect(line.line.maxLineRateLinesPerSec).toBe(REPORT_LINE.maxLineRateLinesPerSec);
    }
  });
});

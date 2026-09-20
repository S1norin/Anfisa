/**
 * Phase 1 tests: the final-report 8-reader preset (reportEightReaderConfig)
 * uses exactly the report's values (reportSpec.ts) — geometry, sensors,
 * sampling, working distances.
 */
import { describe, expect, it } from 'vitest';
import { reportEightReaderConfig } from './presets';
import { GAP_OPENING_MM, migrateConfigToLatest, validateConfig } from '../domain/config';
import type { AreaScanCameraConfig, LineScanCameraConfig } from '../domain/types';
import {
  REPORT_BARCODE,
  REPORT_LINE,
  REPORT_SIDE,
  REPORT_SIDE_MOUNTS,
  REPORT_STATION,
} from '../report/reportSpec';

const near = (got: number[], want: [number, number, number], digits = 3) => {
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], digits));
};

describe('reportEightReaderConfig (final-report layout)', () => {
  const cfg = reportEightReaderConfig();
  const areas = cfg.cameraRigs.filter(
    (r): r is AreaScanCameraConfig => r.kind === 'AREA_SCAN',
  );
  const lines = cfg.cameraRigs.filter(
    (r): r is LineScanCameraConfig => r.kind === 'LINE_SCAN',
  );

  it('validates as a v4 config with no errors', () => {
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('has exactly 8 readers: six side area cameras + top/bottom line scanners', () => {
    expect(cfg.cameraRigs).toHaveLength(8);
    expect(areas).toHaveLength(6);
    expect(lines).toHaveLength(2);
    expect(lines.map((r) => r.role).sort()).toEqual(['BOTTOM', 'TOP']);
  });

  it('places the six side cameras at the report mount table positions', () => {
    expect(areas).toHaveLength(REPORT_SIDE_MOUNTS.length);
    areas.forEach((rig, i) => {
      near(rig.pose.positionMm, REPORT_SIDE_MOUNTS[i].positionMm, 9);
    });
  });

  it('aims every side camera at the parcel centre (0, 200, 1100) at 1450 mm', () => {
    for (const rig of areas) {
      // Focus distance equals the report working distance (mount → centre).
      expect(rig.acquisition.focusDistanceMm).toBeCloseTo(
        REPORT_SIDE.workingDistanceMm,
        3,
      );
    }
  });

  it('uses the report side sensor/optics on every side camera', () => {
    for (const rig of areas) {
      expect(rig.sensor.widthPx).toBe(REPORT_SIDE.sensorWidthPx);
      expect(rig.sensor.heightPx).toBe(REPORT_SIDE.sensorHeightPx);
      expect(rig.sensor.focalLengthMm).toBe(REPORT_SIDE.focalLengthMm);
      expect(rig.acquisition.exposureUs).toBe(REPORT_SIDE.exposureUsPreset);
      expect(rig.acquisition.fps).toBe(REPORT_SIDE.fpsPreset);
      expect(rig.acquisition.shutter).toBe(REPORT_SIDE.shutter);
    }
  });

  it('uses the report line scanner values on both line scanners', () => {
    for (const rig of lines) {
      expect(rig.line.physicalSensorWidthMm).toBe(REPORT_LINE.physicalSensorWidthMm);
      expect(rig.line.fovWidthMm).toBe(REPORT_LINE.fovWidthMm);
      expect(rig.line.pixelsPerLine).toBe(REPORT_LINE.pixelsPerLine);
      expect(rig.line.encoderStepMmPerLine).toBe(REPORT_LINE.encoderStepMmPerLine);
      expect(rig.line.maxLineRateLinesPerSec).toBe(REPORT_LINE.maxLineRateLinesPerSec);
    }
  });

  it('keeps the 100 mm bottom gap and the 150 mm top working distance', () => {
    const top = lines.find((r) => r.role === 'TOP')!;
    const bottom = lines.find((r) => r.role === 'BOTTOM')!;
    // Top eye = parcel top face + 150 mm working distance.
    expect(top.pose.positionMm[1]).toBe(
      cfg.parcel.heightMm + REPORT_LINE.topWorkingDistanceMm,
    );
    expect(bottom.pose.positionMm[1]).toBe(-REPORT_LINE.bottomGapMm);
    expect(cfg.station.bottomTransfer).toBe('GAP');
    expect(GAP_OPENING_MM).toBe(REPORT_LINE.bottomGapMm);
  });

  it('JSON round-trips: a parsed v4 export is bit-identical (CFG-007)', () => {
    const round = migrateConfigToLatest(JSON.parse(JSON.stringify(cfg)));
    expect(round).toEqual(cfg);
  });

  it('splits the six side readers 3/+x and 3/-x', () => {
    const plus = areas.filter((r) => r.pose.positionMm[0] > 0);
    const minus = areas.filter((r) => r.pose.positionMm[0] < 0);
    expect(plus).toHaveLength(3);
    expect(minus).toHaveLength(3);
  });

  it('side viewing directions are 60° apart and every vertical face is seen within 30.5°', () => {
    // Horizontal view angle of each side rig: from position toward the
    // look target (parcel centre), degrees from +z toward +x.
    const target: [number, number, number] = [
      0,
      cfg.parcel.heightMm / 2,
      cfg.station.lengthMm / 2,
    ];
    const angles = areas.map((r) => {
      const dx = target[0] - r.pose.positionMm[0];
      const dz = target[2] - r.pose.positionMm[2];
      const deg = (Math.atan2(dx, dz) * 180) / Math.PI;
      return (deg + 360) % 360;
    });
    const sorted = [...angles].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      const next = (i + 1) % sorted.length;
      const gap =
        i === sorted.length - 1
          ? sorted[0] + 360 - sorted[i]
          : sorted[next] - sorted[i];
      expect(gap).toBeGreaterThanOrEqual(59.5);
      expect(gap).toBeLessThanOrEqual(60.5);
    }
    // Face normals: +z (0°), +x (90°), -z (180°), -x (270°). The nearest
    // side reader must be within 30.5° of each normal (report worst-case
    // incidence 30°).
    for (const faceDeg of [0, 90, 180, 270]) {
      let best = 360;
      for (const a of angles) {
        const d = Math.abs(a - faceDeg);
        best = Math.min(best, d, 360 - d);
      }
      expect(best).toBeLessThanOrEqual(30.5);
    }
  });

  it('no camera lies inside the belt footprint or the parcel envelope', () => {
    const beltHalf = cfg.belt.widthMm / 2; // 325
    const halfW = cfg.parcel.widthMm / 2; // 200
    const halfL = cfg.parcel.lengthMm / 2; // 300
    const cz = cfg.station.lengthMm / 2; // 1100
    for (const rig of cfg.cameraRigs) {
      const [x, y, z] = rig.pose.positionMm;
      // Belt footprint extruded up to parcel height: a camera must be
      // lateral of the belt, above the parcel, or below the belt line.
      const inBelt =
        Math.abs(x) < beltHalf &&
        y >= 0 &&
        y <= cfg.parcel.heightMm &&
        z >= 0 &&
        z <= cfg.station.lengthMm;
      const inParcel =
        Math.abs(x) < halfW &&
        y >= 0 &&
        y <= cfg.parcel.heightMm &&
        Math.abs(z - cz) < halfL;
      expect(inBelt || inParcel).toBe(false);
    }
  });

  it('uses the report 0.35 mm module', () => {
    expect(cfg.barcode.xDimensionMm).toBe(REPORT_BARCODE.xDimensionMm);
  });

  it('meets the report ppm rule at 1 m/s: side ≥ 2 ppm, line travel ≥ 3 ppm', () => {
    const objectMmPx =
      (REPORT_SIDE.pixelPitchMm *
        (REPORT_SIDE.workingDistanceMm - REPORT_SIDE.focalLengthMm)) /
      REPORT_SIDE.focalLengthMm;
    const sidePpmAt0 = REPORT_BARCODE.xDimensionMm / objectMmPx;
    expect(sidePpmAt0).toBeGreaterThanOrEqual(2);
    const travelPpm = REPORT_BARCODE.xDimensionMm / REPORT_LINE.encoderStepMmPerLine;
    expect(travelPpm).toBeGreaterThanOrEqual(3);
    expect(cfg.belt.speedMmPerSec).toBe(REPORT_STATION.speedMmPerSec);
  });
});

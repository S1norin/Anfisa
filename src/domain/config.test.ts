import { CONFIG_VERSION, defaultConfig, migrateConfigToLatest, validateConfig } from './config';
import { defaultLineScanRig } from './camera';

describe('SimConfig defaults (§4)', () => {
  it('matches the plan defaults', () => {
    const cfg = defaultConfig();
    expect(cfg.belt.widthMm).toBe(650);
    expect(cfg.belt.speedMmPerSec).toBe(1000);
    expect(cfg.belt.speedMaxMmPerSec).toBe(1500);
    expect(cfg.parcel).toMatchObject({
      widthMm: 400,
      heightMm: 400,
      lengthMm: 600,
      spawnIntervalMs: 2000,
      labelCountMin: 1,
      labelCountMax: 4,
    });
    expect(cfg.station.lengthMm).toBe(2200);
    expect(cfg.station.sortDistanceMm).toBe(1250);
    expect(cfg.station.sortDistanceMaxMm).toBe(3000);
    expect(cfg.cameras).toMatchObject({
      count: 6,
      sensorWidthPx: 5320,
      sensorHeightPx: 3032,
      previewMaxWidthPx: 960,
      previewMaxHeightPx: 540,
      focalLengthMm: 16,
      exposureUs: 75,
      fps: 20,
      shutter: 'GLOBAL',
    });
    expect(cfg.barcode).toMatchObject({
      symbology: 'CODE128',
      labelWidthMm: 78,
      labelHeightMm: 25,
      xDimensionMm: 0.3,
      payloadPrefix: 'KTY-',
      payloadDigits: 14,
    });
    expect(cfg.quality.coverageMin).toBeCloseTo(0.92);
    expect(cfg.quality.ppmMin).toBeCloseTo(2.0);
    expect(cfg.quality.ppmTarget).toBeCloseTo(3.0);
    expect(cfg.quality.blurPxMax).toBeCloseTo(1.0);
    expect(cfg.quality.incidenceDegMax).toBe(60);
  });

  it('is JSON round-trippable (CFG-003)', () => {
    const cfg = defaultConfig();
    const round = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
    expect(round).toEqual(cfg);
    expect(validateConfig(round)).toEqual([]);
  });

  it('validates defaults with no errors', () => {
    expect(validateConfig(defaultConfig())).toEqual([]);
  });

  it('rejects a sort distance above the 3000 mm cap (§4)', () => {
    const cfg = defaultConfig();
    cfg.station.sortDistanceMm = 4000;
    expect(validateConfig(cfg).map((e) => e.path)).toContain('station.sortDistanceMm');
  });

  it('rejects an unknown config version (CFG-003)', () => {
    const cfg = defaultConfig();
    cfg.version = 99;
    expect(cfg.version).toBe(99);
    expect(validateConfig(cfg).map((e) => e.path)).toContain('version');
  });
});

describe('migrateConfigToLatest (CFG-007)', () => {
  it('migrates a v3 LINE_SCAN rig: sensorWidthMm becomes fovWidthMm, physical derived at 5 µm', () => {
    const cfg = defaultConfig();
    const line = defaultLineScanRig(
      'CAM-L01',
      'TOP',
      [0, 2000, 1100],
      [0, 0, 0, 1],
      0,
    );
    // Re-shape to the exact v3 line block (sensorWidthMm instead of the
    // v4 physical/fov split).
    const v3Line = {
      pixelsPerLine: line.line.pixelsPerLine,
      sensorWidthMm: 512,
      encoderStepMmPerLine: line.line.encoderStepMmPerLine,
      maxLineRateLinesPerSec: line.line.maxLineRateLinesPerSec,
      maxStripLengthMm: line.line.maxStripLengthMm,
      lineExposureUs: line.line.lineExposureUs,
      scanPlaneZMm: line.line.scanPlaneZMm,
    };
    cfg.cameraRigs = [line];
    (cfg.cameraRigs[0] as unknown as typeof line).line = v3Line as unknown as typeof line.line;
    cfg.version = 3;

    const migrated = migrateConfigToLatest(cfg) as typeof cfg;
    expect(migrated).not.toBeNull();
    const mLine = (migrated.cameraRigs[0] as typeof line).line;
    expect(mLine.fovWidthMm).toBe(512); // legacy value preserved as FOV
    expect(mLine.physicalSensorWidthMm).toBeCloseTo(8192 * 0.005, 9); // 40.96
    expect('sensorWidthMm' in mLine).toBe(false);
    expect(migrated.version).toBe(CONFIG_VERSION);
  });

  it('preserves the object-space pixel pitch bit-for-bit (512/8192 = 0.0625 mm/px)', () => {
    const cfg = defaultConfig();
    const line = defaultLineScanRig('CAM-L01', 'TOP', [0, 2000, 1100], [0, 0, 0, 1], 0);
    (cfg.cameraRigs[0] as typeof line).line = {
      ...line.line,
      sensorWidthMm: 512,
    } as (typeof line)['line'] & { sensorWidthMm: number };
    cfg.version = 3;

    const migrated = migrateConfigToLatest(cfg)!;
    const mLine = (migrated.cameraRigs[0] as typeof line).line;
    expect(mLine.fovWidthMm / mLine.pixelsPerLine).toBeCloseTo(0.0625, 9);
  });

  it('keeps already-split v3 rigs intact (idempotent on physical/fov fields)', () => {
    const cfg = defaultConfig();
    const line = defaultLineScanRig('CAM-L01', 'TOP', [0, 2000, 1100], [0, 0, 0, 1], 0);
    cfg.cameraRigs = [line];
    cfg.version = 3;

    const migrated = migrateConfigToLatest(cfg)!;
    const mLine = (migrated.cameraRigs[0] as typeof line).line;
    expect(mLine.physicalSensorWidthMm).toBe(line.line.physicalSensorWidthMm);
    expect(mLine.fovWidthMm).toBe(line.line.fovWidthMm);
  });

  it('migrates v2 configs through v3 to v4 (area rigs untouched)', () => {
    const cfg = defaultConfig();
    cfg.version = 2;
    const migrated = migrateConfigToLatest(cfg)!;
    expect(migrated.version).toBe(CONFIG_VERSION);
    for (const r of migrated.cameraRigs) expect(r.kind).toBe('AREA_SCAN');
  });

  it('rejects version 4+1 and null', () => {
    const cfg = defaultConfig();
    cfg.version = CONFIG_VERSION + 1;
    expect(migrateConfigToLatest(cfg)).toBeNull();
    expect(migrateConfigToLatest(null)).toBeNull();
  });
});

import { defaultConfig, validateConfig } from './config';

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

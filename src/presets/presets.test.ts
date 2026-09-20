/**
 * Named presets + fault scenarios (issue #14, CFG-002, CFG-004).
 *
 * Asserts: every preset is a valid, JSON-round-trippable config (CFG-003);
 * the same preset + seed always builds the identical config (CFG-004);
 * each preset mutates the REAL config fields (no hidden processing branch);
 * and a headless run of a preset is reproducible (same results twice).
 */

import { describe, expect, it } from 'vitest';
import { validateConfig } from '../domain/config';
import type { SimConfig } from '../domain/config';
import type { LineScanCameraConfig } from '../domain/types';
import { SimStore } from '../store/simStore';
import { ProcessRun } from '../pipeline/runDriver';
import {
  DEFAULT_PRESET_SEED,
  FAULT_SCENARIOS,
  PRESETS,
  applyPresetConfig,
  getFaultScenario,
  getPreset,
  validateAllPresets,
} from './presets';

const IDS = [
  'report-8reader',
  'report-6view',
  'recommended-6view',
  'draft-4-oblique',
  'bottom-gap',
  'side-grip',
  'glare-stress',
  'lateral-offset-stress',
  'small-module-stress',
  'camera-failure',
  'close-spacing',
];

describe('named presets (CFG-002)', () => {
  it('exposes the final report layout plus the legacy and comparison presets', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(IDS);
    for (const id of IDS) expect(getPreset(id)).toBeDefined();
  });

  it('report-8reader is the first (default) registry entry', () => {
    expect(PRESETS[0].id).toBe('report-8reader');
  });

  it('lateral-offset-stress: eight-reader layout, parcel at 120 mm (inside the 125 mm guide range)', () => {
    const cfg = getPreset('lateral-offset-stress')!.build();
    expect(cfg.parcel.lateralOffsetMm).toBe(120);
    const areas = cfg.cameraRigs.filter((r) => r.kind === 'AREA_SCAN');
    const lines = cfg.cameraRigs.filter((r) => r.kind === 'LINE_SCAN');
    expect(areas).toHaveLength(6);
    expect(lines).toHaveLength(2);
    // The offset moves the parcel, not the cameras: same poses as report-8reader.
    expect(cfg.cameraRigs.map((r) => r.pose.positionMm)).toEqual(
      getPreset('report-8reader')!.build().cameraRigs.map((r) => r.pose.positionMm),
    );
  });

  it('every preset builds a valid config (CFG-001/CFG-003)', () => {
    const report = validateAllPresets();
    for (const id of IDS) {
      expect(report[id], `preset ${id} should validate`).toEqual([]);
    }
  });

  it('is JSON-round-trippable and structurally identical after a round trip', () => {
    for (const p of PRESETS) {
      const a = p.build();
      const b = JSON.parse(JSON.stringify(a)) as SimConfig;
      expect(validateConfig(b)).toEqual([]);
      expect(b.seed).toBe(a.seed);
    }
  });

  it('same preset + seed → identical config (CFG-004)', () => {
    for (const p of PRESETS) {
      const a = JSON.stringify(p.build(2026));
      const b = JSON.stringify(p.build(2026));
      expect(a).toBe(b);
    }
  });

  it('different seed → different config (seed is carried through)', () => {
    const a = JSON.stringify(PRESETS[0].build(2026));
    const b = JSON.stringify(PRESETS[0].build(7));
    expect(a).not.toBe(b);
    expect(PRESETS[0].build(7).seed).toBe(7);
  });

  it('unknown preset id throws', () => {
    expect(() => applyPresetConfig('nope')).toThrow(/Unknown preset/);
  });

  // Each preset mutates the real config field its name promises.
  it('report layout → 4 oblique area + TOP/BOTTOM line scanners, and a 100 mm gap', () => {
    const cfg = getPreset('report-6view')!.build();
    expect(cfg.cameraRigs).toHaveLength(6);
    expect(cfg.station.bottomTransfer).toBe('GAP');
    const top = cfg.cameraRigs.find((r) => r.role === 'TOP')!;
    const bottom = cfg.cameraRigs.find((r) => r.role === 'BOTTOM')!;
    expect(top.kind).toBe('LINE_SCAN');
    expect(bottom.kind).toBe('LINE_SCAN');
    expect(cfg.cameraRigs.filter((r) => r.kind === 'AREA_SCAN')).toHaveLength(4);
    expect(cfg.cameraRigs.filter((r) => r.name.includes('45°'))).toHaveLength(4);
    // The BOTTOM scan plane sits at the GAP centre (station centre).
    expect((bottom as LineScanCameraConfig).line.scanPlaneZMm).toBe(cfg.station.lengthMm / 2);
  });

  it('draft-4-oblique → exactly four enabled side readers, no top/bottom', () => {
    const cfg = getPreset('draft-4-oblique')!.build();
    expect(cfg.cameraRigs).toHaveLength(4);
    const roles = cfg.cameraRigs.map((r) => r.role);
    expect(roles.sort()).toEqual(['FRONT', 'LEFT', 'REAR', 'RIGHT']);
  });

  it('bottom-gap → GAP transfer', () => {
    expect(getPreset('bottom-gap')!.build().station.bottomTransfer).toBe('GAP');
  });

  it('side-grip → SIDE_GRIP transfer', () => {
    expect(getPreset('side-grip')!.build().station.bottomTransfer).toBe('SIDE_GRIP');
  });

  it('glare-stress → glossy tape, unpolarized wide-open readers, line lights toggled only', () => {
    const cfg = getPreset('glare-stress')!.build();
    expect(cfg.parcel.tapeChance).toBe(1);
    expect(cfg.parcel.material).toBe('WHITE_CARD');
    for (const r of cfg.cameraRigs) {
      expect(r.illumination.polarized).toBe(false);
      expect(r.illumination.ambientLeak).toBeGreaterThan(0.5);
      if (r.kind === 'AREA_SCAN') {
        expect(r.optics.apertureProxy).toBeLessThan(4);
      } else {
        // Line rigs: only the illumination fields change — no optics block
        // is invented, and the strip effects stay at their preset values.
        expect(r.illumination.intensity).toBe(1.2);
        expect(r.imageEffects).toEqual({ jitter: 0, missingLineChance: 0, banding: 0 });
        expect('optics' in r).toBe(false);
        expect('acquisition' in r).toBe(false);
      }
    }
  });

  it('small-module-stress → 0.3 mm modules', () => {
    expect(getPreset('small-module-stress')!.build().barcode.xDimensionMm).toBe(0.3);
  });

  it('camera-failure → TOP line scanner disabled in config', () => {
    const cfg = getPreset('camera-failure')!.build();
    const top = cfg.cameraRigs.find((r) => r.role === 'TOP')!;
    expect(top.kind).toBe('LINE_SCAN');
    expect(top.enabled).toBe(false);
    const othersEnabled = cfg.cameraRigs.filter((r) => r.role !== 'TOP');
    expect(othersEnabled.every((r) => r.enabled)).toBe(true);
  });

  it('close-spacing → 600 ms front-to-front', () => {
    expect(getPreset('close-spacing')!.build().parcel.spawnIntervalMs).toBe(600);
  });
});

describe('preset run reproducibility (CFG-004)', () => {
  function summary(run: ProcessRun) {
    return JSON.stringify(
      run.pipeline.results.map((r) => ({
        parcelId: r.parcelId,
        status: r.status,
        payloads: r.payloads,
        labels: r.labelResults.map((l) => ({
          instance: l.labelInstanceId,
          decoded: l.decoded,
          confidence: l.bestConfidence,
        })),
      })),
    );
  }

  it('report layout produces usable barcode observations', () => {
    const run = new ProcessRun(applyPresetConfig('report-6view', DEFAULT_PRESET_SEED), 6);
    run.runToCompletion();
    expect(run.totalDecodedObservations).toBeGreaterThan(0);
    expect(run.pipeline.results.some((result) => result.decodedLabels > 0)).toBe(true);
  });

  it('recommended-6view reproduces identical parcel results (same seed)', () => {
    const a = new ProcessRun(applyPresetConfig('recommended-6view', DEFAULT_PRESET_SEED), 4);
    a.runToCompletion();
    const b = new ProcessRun(applyPresetConfig('recommended-6view', DEFAULT_PRESET_SEED), 4);
    b.runToCompletion();
    expect(a.pipeline.results.length).toBeGreaterThan(0);
    expect(summary(a)).toBe(summary(b));
  });

  it('small-module-stress reproduces identical (degraded) results', () => {
    const a = new ProcessRun(applyPresetConfig('small-module-stress', DEFAULT_PRESET_SEED), 4);
    a.runToCompletion();
    const b = new ProcessRun(applyPresetConfig('small-module-stress', DEFAULT_PRESET_SEED), 4);
    b.runToCompletion();
    expect(a.pipeline.results.length).toBeGreaterThan(0);
    expect(summary(a)).toBe(summary(b));
  });

  it('camera-failure: TOP reader contributes no observations and top-face labels never decode', () => {
    const run = new ProcessRun(applyPresetConfig('camera-failure', DEFAULT_PRESET_SEED), 8);
    run.runToCompletion();
    // The preset disables the TOP rig; find its id in the built config.
    const topId = run.sim.state.config.cameraRigs.find((r) => r.role === 'TOP')!.id;
    expect(topId.length).toBeGreaterThan(0);
    const topLabels = run.pipeline.results
      .flatMap((r) => r.labelResults)
      .filter((l) => l.face === 'TOP');
    // The seeded run has top-face labels; with TOP disabled they can never decode.
    expect(topLabels.length).toBeGreaterThan(0);
    for (const l of topLabels) {
      expect(l.decoded).toBe(false);
      // The TOP reader must contribute no observations at all.
      expect(l.cameras).not.toContain(topId);
    }
    const anyObservedByTop = run.pipeline.results
      .flatMap((r) => r.labelResults)
      .some((l) => l.cameras.includes(topId));
    expect(anyObservedByTop).toBe(false);
  });
});

describe('fault scenarios (live config mutations)', () => {
  it('exposes rolling-shutter, speed-change, and camera-fault', () => {
    expect(FAULT_SCENARIOS.map((f) => f.id)).toEqual([
      'rolling-shutter',
      'speed-change',
      'camera-fault',
    ]);
  });

  it('rolling-shutter switches only area readers; mixed report layout stays valid', () => {
    const store = new SimStore(applyPresetConfig('report-6view'));
    getFaultScenario('rolling-shutter')!.apply(store);
    const cfg = store.sim.state.config;
    for (const r of cfg.cameraRigs) {
      if (r.kind === 'AREA_SCAN') {
        expect(r.acquisition.shutter).toBe('ROLLING');
      } else {
        // No acquisition block may be invented on line rigs.
        expect('acquisition' in r).toBe(false);
      }
    }
    expect(validateConfig(cfg)).toEqual([]);
  });

  it('camera-fault raises FAULT on the first (oblique area) reader without crashing', () => {
    const store = new SimStore(applyPresetConfig('report-6view'));
    getFaultScenario('camera-fault')!.apply(store);
    const first = store.sim.state.config.cameraRigs[0]!;
    expect(first.kind).toBe('AREA_SCAN');
    expect(store.sim.state.cameraStates[first.id]).toBe('FAULT');
  });
});

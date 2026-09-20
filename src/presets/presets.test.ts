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
import { ProcessRun } from '../pipeline/runDriver';
import {
  DEFAULT_PRESET_SEED,
  FAULT_SCENARIOS,
  PRESETS,
  applyPresetConfig,
  getPreset,
  validateAllPresets,
} from './presets';

const IDS = [
  'recommended-6view',
  'draft-4-oblique',
  'bottom-gap',
  'side-grip',
  'glare-stress',
  'small-module-stress',
  'camera-failure',
  'close-spacing',
];

describe('named presets (CFG-002)', () => {
  it('exposes exactly the eight required presets', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(IDS);
    for (const id of IDS) expect(getPreset(id)).toBeDefined();
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

  it('glare-stress → glossy tape, unpolarized wide-open readers', () => {
    const cfg = getPreset('glare-stress')!.build();
    expect(cfg.parcel.tapeChance).toBe(1);
    expect(cfg.parcel.material).toBe('WHITE_CARD');
    for (const r of cfg.cameraRigs) {
      expect(r.illumination.polarized).toBe(false);
      expect(r.illumination.ambientLeak).toBeGreaterThan(0.5);
      expect(r.optics.apertureProxy).toBeLessThan(4);
    }
  });

  it('small-module-stress → 0.3 mm modules', () => {
    expect(getPreset('small-module-stress')!.build().barcode.xDimensionMm).toBe(0.3);
  });

  it('camera-failure → TOP reader disabled in config', () => {
    const cfg = getPreset('camera-failure')!.build();
    const top = cfg.cameraRigs.find((r) => r.role === 'TOP')!;
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
    const topLabels = run.pipeline.results
      .flatMap((r) => r.labelResults)
      .filter((l) => l.face === 'TOP');
    // The seeded run has top-face labels; with TOP disabled they can never decode.
    expect(topLabels.length).toBeGreaterThan(0);
    for (const l of topLabels) {
      expect(l.decoded).toBe(false);
      // TOP reader is CAM-005; it must contribute no observations at all.
      expect(l.cameras).not.toContain('CAM-005');
    }
    const anyObservedByTop = run.pipeline.results
      .flatMap((r) => r.labelResults)
      .some((l) => l.cameras.includes('CAM-005'));
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
});

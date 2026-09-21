/**
 * JSON export/import (issue #15, t15-1, t15-2): versioned config envelope
 * (CFG-003, CFG-007), full run record (AC-10), observation audit log.
 *
 * The phase acceptance criterion (AC-10) is covered explicitly:
 * export config -> import -> re-run asserts identical domain results for
 * the same config version + seed.
 */

import { describe, expect, it } from 'vitest';
import { CONFIG_VERSION, defaultConfig } from '../domain/config';
import { defaultLineScanRig } from '../domain/camera';
import type { SimEvent } from '../domain/types';
import { recommendedSixViewConfig } from '../capture/presets';
import { ProcessRun } from '../pipeline/runDriver';
import { SimStore } from '../store/simStore';
import {
  CONFIG_KIND,
  OBSERVATIONS_KIND,
  RUN_KIND,
  buildLiveRunRecord,
  configToJson,
  framesFromEvents,
  observationsToJson,
  parseConfigImport,
  runRecordToJson,
} from './json';

function baselineRun(): ProcessRun {
  const cfg = recommendedSixViewConfig();
  cfg.seed = 2026;
  cfg.belt.speedMmPerSec = 1000;
  cfg.parcel.labelCountMin = 1;
  cfg.parcel.labelCountMax = 4;
  cfg.parcel.material = 'KRAFT';
  cfg.parcel.tapeChance = 0;
  cfg.parcel.labelDamageChance = 0;
  const run = new ProcessRun(cfg, 20);
  run.runToCompletion();
  return run;
}

describe('config export/import (CFG-003, CFG-007)', () => {
  it('round-trips a valid config byte-for-byte (CFG-003)', () => {
    const cfg = recommendedSixViewConfig();
    const text = configToJson(cfg);
    const result = parseConfigImport(text);
    expect(result.ok).toBe(true);
    // JSON canonicalizes -0 to 0 (one rig direction carries -0), so the
    // round-trip contract is canonical-form equality.
    if (result.ok) {
      expect(JSON.stringify(result.config)).toBe(JSON.stringify(cfg));
    }

    const env = JSON.parse(text);
    expect(env.kind).toBe(CONFIG_KIND);
    expect(env.configVersion).toBe(CONFIG_VERSION);
  });

  it('rejects invalid JSON', () => {
    const result = parseConfigImport('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('invalid JSON');
  });

  it('rejects unknown or missing kind', () => {
    expect(parseConfigImport('{"kind":"other"}').ok).toBe(false);
    expect(parseConfigImport('{}').ok).toBe(false);
    expect(parseConfigImport('[1,2,3]').ok).toBe(false);
  });

  it('rejects unknown future config versions instead of guessing (CFG-007)', () => {
    const env = JSON.parse(configToJson(defaultConfig()));
    env.configVersion = CONFIG_VERSION + 1;
    const result = parseConfigImport(JSON.stringify(env));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('not supported');
  });

  it('rejects configs failing CFG-001 validation with field paths', () => {
    const env = JSON.parse(configToJson(defaultConfig()));
    env.config.belt.speedMmPerSec = -5;
    const result = parseConfigImport(JSON.stringify(env));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('belt.speedMmPerSec');
    }
  });

  it('imports a v2-serialized config as AREA_SCAN v3 with unchanged behavior', () => {
    const cfg = defaultConfig();
    const env = JSON.parse(configToJson(cfg)) as {
      kind: string;
      configVersion: number;
      config: {
        version: number;
        cameraRigs: Record<string, unknown>[];
      };
    };
    // Downgrade to the v2 shape: version 2 in envelope and body, no
    // `kind` discriminator on the rigs.
    env.configVersion = 2;
    env.config.version = 2;
    env.config.cameraRigs = env.config.cameraRigs.map((r) => {
      const rest: Record<string, unknown> = { ...r };
      delete rest.kind;
      return rest;
    });
    const result = parseConfigImport(JSON.stringify(env));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.config.version).toBe(CONFIG_VERSION);
    for (const r of result.config.cameraRigs) expect(r.kind).toBe('AREA_SCAN');
    // Unchanged behavior: the migrated config equals the original once the
    // kind discriminator is set on every rig.
    const originalV3 = cfg.cameraRigs.map((r) => ({ ...r }));
    expect(result.config.cameraRigs).toEqual(originalV3);
  });

  it('a mixed AREA + LINE config exports as v3 and round-trips deep-equal', () => {
    const cfg = defaultConfig();
    const line = defaultLineScanRig(
      'CAM-L01',
      'TOP',
      [0, 2000, 1100],
      [0, 0, 0, 1],
      0,
    );
    cfg.cameraRigs = [
      ...cfg.cameraRigs.filter((r) => r.role !== 'TOP'),
      line,
    ];
    const text = configToJson(cfg);
    const env = JSON.parse(text);
    expect(env.configVersion).toBe(CONFIG_VERSION);
    const result = parseConfigImport(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(JSON.stringify(result.config)).toBe(JSON.stringify(cfg));
    const kinds = result.config.cameraRigs.map((r) => r.kind);
    expect(kinds).toContain('AREA_SCAN');
    expect(kinds).toContain('LINE_SCAN');
  });

  it('AC-10: export -> import -> re-run reproduces identical results', () => {
    const original = baselineRun();
    const record = original.record();

    const text = configToJson(record.config);
    const imported = parseConfigImport(text);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error('unreachable');

    const reRun = new ProcessRun(imported.config, 20);
    reRun.runToCompletion();
    const reRecord = reRun.record();

    expect(JSON.stringify(reRecord.results)).toBe(JSON.stringify(record.results));
    expect(JSON.stringify(reRecord.observations)).toBe(
      JSON.stringify(record.observations),
    );
    expect(JSON.stringify(reRecord.metrics)).toBe(JSON.stringify(record.metrics));
    expect(reRecord.seed).toBe(record.seed);
  });
});

describe('run record JSON (AC-10)', () => {
  it('wraps the full audit trail in a versioned envelope', () => {
    const record = baselineRun().record();
    const env = JSON.parse(runRecordToJson(record));
    expect(env.kind).toBe(RUN_KIND);
    expect(env.recordVersion).toBe(1);
    expect(env.configVersion).toBe(CONFIG_VERSION);
    expect(env.record.seed).toBe(2026);
    expect(env.record.groundTruth).toHaveLength(20);
    expect(env.record.frames.length).toBeGreaterThan(0);
    expect(env.record.observations.length).toBeGreaterThan(0);
    expect(env.record.results).toHaveLength(20);
    expect(env.record.metrics.completeReadRate).toBe(1);
    // Camera snapshots: every frame carries camera + encoder position.
    for (const f of env.record.frames) {
      expect(f.cameraId).toBeTruthy();
      expect(typeof f.encoderMm).toBe('number');
      expect(Array.isArray(f.candidateParcelIds)).toBe(true);
    }
    // Processing mode (t4-labeling): run level + every frame.
    expect(env.record.processingMode).toBe('GEOMETRY_MODEL');
    for (const f of env.record.frames) {
      expect(f.processingMode).toBe('GEOMETRY_MODEL');
    }
  });

  function baselineCfg(): ReturnType<typeof recommendedSixViewConfig> {
    const cfg = recommendedSixViewConfig();
    cfg.seed = 2026;
    cfg.belt.speedMmPerSec = 1000;
    cfg.parcel.labelCountMin = 1;
    cfg.parcel.labelCountMax = 4;
    cfg.parcel.material = 'KRAFT';
    cfg.parcel.tapeChance = 0;
    cfg.parcel.labelDamageChance = 0;
    return cfg;
  }

  it('buildLiveRunRecord mirrors the headless record over the same steps', () => {
    const headless = new ProcessRun(baselineCfg(), 20);
    headless.runToCompletion();
    const headlessRecord = headless.record();

    // Drive the live store one domain step per tick (speed factor 1:
    // tick(5 ms) = 1 step). At 1-step granularity, finalize/ACK fire at
    // the same sim times as the headless driver, so the records are
    // byte-identical. (Larger ticks finalize at ≤ tick granularity.)
    // Mirror the driver's 20-parcel spawn cap so the capture sets match.
    const store = new SimStore(baselineCfg());
    store.sim.start();
    let done = false;
    for (let t = 0; t < headlessRecord.simTimeMs && !done; t += 5) {
      store.tick(5);
      if (store.parcelsSpawned >= 20) store.sim.state.nextSpawnMs = Infinity;
      const results = store.results;
      done =
        results.length === 20 &&
        results.every((r) => r.ackSimTimeMs !== undefined);
    }
    expect(done).toBe(true);
    expect(store.sim.state.simTimeMs).toBe(headlessRecord.simTimeMs);
    const live = buildLiveRunRecord(store, store.computeLiveMetrics());

    expect(live.results.length).toBe(headlessRecord.results.length);
    expect(JSON.stringify(live.results)).toBe(JSON.stringify(headlessRecord.results));
    expect(live.frames.length).toBe(headlessRecord.frames.length);
    for (let i = 0; i < live.frames.length; i++) {
      expect(live.frames[i].cameraId).toBe(headlessRecord.frames[i].cameraId);
      expect(live.frames[i].simTimeMs).toBe(headlessRecord.frames[i].simTimeMs);
      expect(live.frames[i].encoderMm).toBe(headlessRecord.frames[i].encoderMm);
      expect(live.frames[i].candidateParcelIds).toEqual(
        headlessRecord.frames[i].candidateParcelIds,
      );
    }
  });
});

describe('observations JSON (AC-10)', () => {
  it('exports the audit log with run identity', () => {
    const record = baselineRun().record();
    const env = JSON.parse(
      observationsToJson(record.runId, record.seed, record.observations),
    );
    expect(env.kind).toBe(OBSERVATIONS_KIND);
    expect(env.runId).toBe(record.runId);
    expect(env.seed).toBe(2026);
    expect(env.observations).toHaveLength(record.observations.length);
    expect(env.observations[0]).toEqual(record.observations[0]);
  });
});

describe('framesFromEvents (encoder replay)', () => {
  it('integrates speed between events and rounds to 0.01 mm', () => {
    const events: SimEvent[] = [
      {
        type: 'CAMERA_CAPTURED',
        cameraId: 'cam-top',
        simTimeMs: 100,
        candidateParcelIds: ['p1'],
      },
      { type: 'SPEED_CHANGED', simTimeMs: 200, fromMmPerSec: 1000, toMmPerSec: 500 },
      {
        type: 'CAMERA_CAPTURED',
        cameraId: 'cam-top',
        simTimeMs: 400,
        candidateParcelIds: [],
      },
    ];
    const frames = framesFromEvents(events, 1000);
    expect(frames).toHaveLength(2);
    expect(frames[0].encoderMm).toBe(100); // 1 m/s for 100 ms
    expect(frames[0].frameId).toBe('cam-top@100');
    // 100 (to t=200) + 100 (speed change at 200) + 0.5 m/s for 200 ms = 300
    expect(frames[1].encoderMm).toBe(300);
  });

  it('ignores non-scheduling events', () => {
    const events: SimEvent[] = [
      {
        type: 'PARCEL_SPAWNED',
        parcelId: 'p1',
        simTimeMs: 0,
        encoderMm: 0,
      },
      {
        type: 'CAMERA_CAPTURED',
        cameraId: 'c',
        simTimeMs: 50,
        candidateParcelIds: [],
      },
    ];
    expect(framesFromEvents(events, 1000)).toHaveLength(1);
  });
});

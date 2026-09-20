/**
 * Demo acceptance scenarios (THREEJS_DEMO_PLAN.md §13, issue #16, t16-3).
 *
 * Each AC gets an explicit, headless, deterministic scenario. AC-01
 * (metrics/baseline.test.ts), AC-08 (store/determinism.test.ts) and
 * AC-10 (export/export.test.ts) have dedicated suites and are linked,
 * not duplicated; AC-09 is a visual reviewer check (README walkthrough).
 */

import { describe, expect, it } from 'vitest';
import { recommendedSixViewConfig } from '../capture/presets';
import { defaultConfig } from '../domain/config';
import type { SimConfig } from '../domain/config';
import type {
  AreaScanCameraConfig,
  LabelInstance,
  ParcelState,
  ParcelSpec,
} from '../domain/types';
import { observeLabels, type LabelObservationResult, type ObserveContext } from '../observation/observationEngine';
import { ParcelPipeline, type PipelineFrame } from '../pipeline/pipeline';
import { ProcessRun } from '../pipeline/runDriver';
import { applyPresetConfig } from '../presets';

// ---------- fixtures (same style as pipeline.test.ts) ----------

function makeCfg(): SimConfig {
  const cfg = defaultConfig();
  cfg.barcode.xDimensionMm = 1.1;
  return cfg;
}

function makeParcel(over: Partial<ParcelState> = {}): ParcelState {
  return {
    parcelId: 'P-001',
    spec: {
      widthMm: 400,
      heightMm: 400,
      lengthMm: 600,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm: 1100,
    phase: 'ENTERED',
    ...over,
  };
}

function label(id: string, payload: string, face: LabelInstance['face']): LabelInstance {
  return {
    labelInstanceId: id,
    payload,
    face,
    localOffsetMm: [0, 0],
    rotationDeg: 0,
    widthMm: 78,
    heightMm: 25,
    damage: 0,
  };
}

const OBS_DEFAULTS: LabelObservationResult = {
  parcelId: 'P-001',
  labelInstanceId: 'L-0001',
  face: 'TOP',
  projectedCornersPx: [],
  coverage: 1,
  distanceMm: 1000,
  incidenceDeg: 30,
  pixelsPerModule: 4,
  blurPx: 0,
  qualityComponents: {},
  confidence: 1,
  reasons: [],
  qualityPassed: true,
  qualityGates: [],
};

function obs(over: Partial<LabelObservationResult>): LabelObservationResult {
  return { ...OBS_DEFAULTS, ...over };
}

function frame(over: Partial<PipelineFrame>): PipelineFrame {
  return {
    frameId: 'F-1',
    cameraId: 'CAM-TOP',
    cameraState: 'CAPTURING',
    simTimeMs: 1000,
    encoderPositionMm: 2000,
    candidateParcelIds: ['P-001'],
    labels: [],
    ...over,
  };
}

const NOW = { simTimeMs: 1000, encoderMm: 2000 };

/** Clean baseline config: the deliberately easy 100% read (AC-01). */
function cleanBaseline(): SimConfig {
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

// ---------- AC-02 ----------

describe('AC-02: multiple labels and repeated payload', () => {
  it('five instances survive finalization; repeated frames collapse per instance', () => {
    // 3 labels on TOP (A,B,C) + 2 labels on LEFT with the SAME payload D.
    const parcel = makeParcel({
      entrySimTimeMs: 800,
      exitSimTimeMs: 1500,
      spec: {
        ...makeParcel().spec,
        labels: [
          label('L-A', 'KTY-AAAAAAAAAAAAAA', 'TOP'),
          label('L-B', 'KTY-BBBBBBBBBBBBBB', 'TOP'),
          label('L-C', 'KTY-CCCCCCCCCCCCCC', 'TOP'),
          label('L-D1', 'KTY-DDDDDDDDDDDDDD', 'LEFT'),
          label('L-D2', 'KTY-DDDDDDDDDDDDDD', 'LEFT'),
        ],
      },
    });
    const pipe = new ParcelPipeline();
    const topLabels = [
      obs({ labelInstanceId: 'L-A', face: 'TOP' }),
      obs({ labelInstanceId: 'L-B', face: 'TOP' }),
      obs({ labelInstanceId: 'L-C', face: 'TOP' }),
    ];
    const leftLabels = [
      obs({ labelInstanceId: 'L-D1', face: 'LEFT' }),
      obs({ labelInstanceId: 'L-D2', face: 'LEFT' }),
    ];
    // Three frames per camera: repeated frames of the same instances.
    // `now` advances with the belt so the association windows hold.
    for (let t = 0; t < 3; t++) {
      const at = {
        simTimeMs: 1000 + t * 50,
        encoderMm: 2000 + t * 50,
      };
      pipe.processFrame(
        frame({
          frameId: `F-T${t}`,
          cameraId: 'CAM-TOP',
          simTimeMs: at.simTimeMs,
          encoderPositionMm: at.encoderMm,
          labels: topLabels,
        }),
        at,
        [parcel],
      );
      pipe.processFrame(
        frame({
          frameId: `F-L${t}`,
          cameraId: 'CAM-LEFT',
          simTimeMs: at.simTimeMs,
          encoderPositionMm: at.encoderMm,
          labels: leftLabels,
        }),
        at,
        [parcel],
      );
    }

    const r = pipe.finalizeDue(1750, makeCfg(), [parcel])[0];
    // All five physical instances remain present (REV-10):
    expect(r.labelResults.map((l) => l.labelInstanceId).sort()).toEqual([
      'L-A', 'L-B', 'L-C', 'L-D1', 'L-D2',
    ]);
    expect(r.labelResults.every((l) => l.decoded)).toBe(true);
    // Both physical D labels decode (they are separate instances, REV-10);
    // the payload value is repeated, not merged:
    expect([...r.payloads].sort()).toEqual([
      'KTY-AAAAAAAAAAAAAA',
      'KTY-BBBBBBBBBBBBBB',
      'KTY-CCCCCCCCCCCCCC',
      'KTY-DDDDDDDDDDDDDD',
      'KTY-DDDDDDDDDDDDDD',
    ]);
    // Repeated frames of the same instance collapse into one entry:
    for (const l of r.labelResults) {
      expect(l.observationCount).toBe(3);
      expect(l.decodedCount).toBe(3);
    }
  });
});

// ---------- AC-03 ----------

describe('AC-03: a camera change affects the pipeline', () => {
  const cfg = recommendedSixViewConfig();
  function topRig(): AreaScanCameraConfig {
    return cfg.cameraRigs.find((r): r is AreaScanCameraConfig => r.role === 'TOP')!;
  }
  const parcel = makeParcel({
    entrySimTimeMs: 800,
    exitSimTimeMs: 1500,
    spec: {
      ...makeParcel().spec,
      labels: [label('L-0001', 'KTY-12345678901234', 'TOP')],
    },
  });
  const ctx: ObserveContext = { simTimeMs: 1000, speedMmPerSec: 1000 };

  it('baseline: the top label is readable (PPM above the gate)', () => {
    const out = observeLabels(topRig(), 'CAPTURING', [parcel], [parcel], ctx, cfg);
    expect(out[0].qualityPassed).toBe(true);
    expect(out[0].pixelsPerModule).toBeGreaterThan(1);
  });

  it('moving the reader 1 m away crosses the PPM gate coherently', () => {
    const rig = topRig();
    const dy = 1000;
    const moved = {
      ...rig,
      pose: {
        positionMm: [
          rig.pose.positionMm[0],
          rig.pose.positionMm[1] + dy,
          rig.pose.positionMm[2],
        ] as [number, number, number],
        quaternion: rig.pose.quaternion,
      },
      acquisition: {
        ...rig.acquisition,
        focusDistanceMm: rig.acquisition.focusDistanceMm + dy,
      },
    };
    const base = observeLabels(rig, 'CAPTURING', [parcel], [parcel], ctx, cfg);
    const out = observeLabels(moved, 'CAPTURING', [parcel], [parcel], ctx, cfg);
    expect(base[0].qualityPassed).toBe(true);
    expect(out[0].qualityPassed).toBe(false);
    expect(out[0].pixelsPerModule).toBeLessThan(base[0].pixelsPerModule);
    expect(out[0].reasons).toContain('LOW_PPM');

    // The pipeline turns that into a NO_READ result with the reason code —
    // feed, PPM display, reason, and status all update coherently.
    const pipe = new ParcelPipeline();
    pipe.processFrame(frame({ cameraId: 'CAM-TOP', labels: out }), NOW, [parcel]);
    const r = pipe.finalizeDue(1750, cfg, [parcel])[0];
    expect(r.status).toBe('NO_READ');
    expect(r.labelResults[0].decoded).toBe(false);
    expect(r.labelResults[0].reasons).toContain('LOW_PPM');
  });
});

// ---------- AC-04 ----------

describe('AC-04: exposure and belt speed change what is visible', () => {
  it('a long exposure drives MOTION_BLUR and the metrics follow', () => {
    const base = new ProcessRun(cleanBaseline(), 10);
    base.runToCompletion();
    const baseMetrics = base.record().metrics;
    expect(baseMetrics.completeReadRate).toBe(1);

    const cfg = cleanBaseline();
    for (const r of cfg.cameraRigs as AreaScanCameraConfig[]) r.acquisition.exposureUs = 400;
    const run = new ProcessRun(cfg, 10);
    run.runToCompletion();

    const blurReasons = new Set<string>();
    let decoded = 0;
    for (const r of run.pipeline.results) {
      for (const l of r.labelResults) {
        if (l.decoded) decoded++;
        else for (const x of l.reasons) blurReasons.add(x);
      }
    }
    expect(blurReasons).toContain('MOTION_BLUR');
    expect(decoded).toBe(0);
    expect(run.record().metrics.completeReadRate).toBeLessThan(baseMetrics.completeReadRate);
  });
});

// ---------- AC-05 ----------

describe('AC-05: bottom labels are truthful to the station model', () => {
  // The geometry model (stationGeometry.test.ts, issue #8): GAP transfer
  // occludes the bottom face except a centred 100 mm opening; SIDE_GRIP
  // exposes it across the whole transfer zone. The observation engine
  // mirrors this (stationDeckOccludesBottom) and the per-observation
  // stream reflects it.
  function bottomObs(id: 'bottom-gap' | 'side-grip') {
    const run = new ProcessRun(applyPresetConfig(id), 10);
    run.runToCompletion();
    const rec = run.record();
    const byLabel = new Map<string, { total: number; passed: number }>();
    for (const o of rec.observations) {
      if (o.face !== 'BOTTOM') continue;
      const k = `${o.parcelId}:${o.labelInstanceId}`;
      const e = byLabel.get(k) ?? { total: 0, passed: 0 };
      e.total++;
      if (o.qualityPassed) e.passed++;
      byLabel.set(k, e);
    }
    return { obs: byLabel, results: rec.results };
  }

  it('GAP: bottom labels are occluded away from the opening; the strip still decodes', () => {
    const { obs, results } = bottomObs('bottom-gap');
    expect(obs.size).toBeGreaterThan(0);
    // Outside the 100 mm strip the deck blocks the face: only a handful
    // of in-strip frames pass quality for every bottom label.
    for (const [k, e] of obs) {
      expect(e.total, k).toBeGreaterThan(0);
      expect(e.passed, k).toBeLessThan(e.total);
      expect(e.passed, k).toBeGreaterThanOrEqual(1);
    }
    // The label crossing the gap strip is decoded truthfully, and the
    // occluded majority leaves the OCCLUDED reason in the aggregate.
    const bottoms = results.flatMap((r) => r.labelResults).filter((l) => l.face === 'BOTTOM');
    expect(bottoms.length).toBe(obs.size);
    expect(bottoms.every((l) => l.decoded)).toBe(true);
    expect(bottoms.every((l) => l.reasons.includes('OCCLUDED'))).toBe(true);
  });

  it('SIDE_GRIP: the bottom face is exposed across the transfer zone', () => {
    const gap = bottomObs('bottom-gap');
    const grip = bottomObs('side-grip');
    // Same seed → identical parcels and label instances.
    expect([...grip.obs.keys()].sort()).toEqual([...gap.obs.keys()].sort());
    for (const [k, e] of grip.obs) {
      // Fully observable zone: far more quality frames than through the
      // 100 mm gap strip.
      expect(e.passed, k).toBeGreaterThan(gap.obs.get(k)!.passed);
      expect(e.passed, k).toBeGreaterThan(10);
    }
  });
});

// ---------- AC-06 ----------

describe('AC-06: sensor fault handling', () => {
  it('a faulted sole reader yields a fault/NO_READ result, never stale data', () => {
    // Parcel with a label visible ONLY to the LEFT reader; the LEFT reader
    // is FAULT. No stale result may be emitted with a decoded payload.
    const cfg = makeCfg();
    const rig = recommendedSixViewConfig().cameraRigs.find(
      (r): r is AreaScanCameraConfig => r.role === 'LEFT',
    )!;
    const parcel = makeParcel({
      entrySimTimeMs: 800,
      exitSimTimeMs: 1500,
      spec: {
        ...makeParcel().spec,
        labels: [label('L-0001', 'KTY-12345678901234', 'TOP')],
      },
    });
    const ctx: ObserveContext = { simTimeMs: 1000, speedMmPerSec: 1000 };
    const out = observeLabels(rig, 'FAULT', [parcel], [parcel], ctx, cfg);
    expect(out[0].qualityPassed).toBe(false);
    expect(out[0].reasons).toContain('CAMERA_FAULT');

    const pipe = new ParcelPipeline();
    pipe.processFrame(frame({ cameraId: 'CAM-LEFT', labels: out }), NOW, [parcel]);
    const r = pipe.finalizeDue(1750, cfg, [parcel])[0];
    expect(r.status).toBe('SENSOR_FAULT');
    expect(r.payloads).toEqual([]); // nothing decoded, nothing fabricated
    expect(r.labelResults[0].decoded).toBe(false);
    expect(r.labelResults[0].reasons).toContain('CAMERA_FAULT');
  });
});

// ---------- AC-07 ----------

describe('AC-07: close spacing and speed change stay consistent', () => {
  it('nearly touching parcels + mid-run speed change: no mis-association, no foreign payloads', () => {
    const cfg = applyPresetConfig('close-spacing');
    cfg.seed = 2026;
    const run = new ProcessRun(cfg, 12);
    run.stepMany(2000); // ~10 s at 600 ms spacing
    run.sim.state.speedMmPerSec = 600; // speed change mid-run
    run.runToCompletion();

    const results = run.pipeline.results;
    expect(results.length).toBeGreaterThanOrEqual(10);
    // No AMBIGUOUS: the association windows survive the close spacing.
    expect(results.every((r) => r.status !== 'AMBIGUOUS')).toBe(true);
    // Every reported payload belongs to the parcel's own ground truth.
    const specs = new Map<string, ParcelSpec>();
    for (const f of run.sim.state.finalized) specs.set(f.parcelId, f.spec);
    for (const p of run.sim.state.parcels.values()) specs.set(p.parcelId, p.spec);
    for (const r of results) {
      const groundTruth = (specs.get(r.parcelId)?.labels ?? []).map((l) => l.payload);
      for (const p of r.payloads) {
        expect(groundTruth, `parcel ${r.parcelId}`).toContain(p);
      }
    }
    // Metrics remain coherent: evaluated count matches finalized count.
    expect(run.record().metrics.evaluatedParcels).toBe(results.length);
  });
});

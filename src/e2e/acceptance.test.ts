/**
 * Demo acceptance scenarios (THREEJS_DEMO_PLAN.md §13, issue #16, t16-3).
 *
 * Each AC gets an explicit, headless, deterministic scenario. AC-01
 * (metrics/baseline.test.ts), AC-08 (store/determinism.test.ts) and
 * AC-10 (export/export.test.ts) have dedicated suites and are linked,
 * not duplicated; AC-09 is a visual reviewer check (README walkthrough).
 */

import { describe, expect, it } from 'vitest';
import { reportEightReaderConfig, recommendedSixViewConfig } from '../capture/presets';
import { defaultConfig } from '../domain/config';
import type { SimConfig } from '../domain/config';
import type {
  AreaScanCameraConfig,
  LabelInstance,
  LineScanCameraConfig,
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

// ---------- t7: line-scan e2e acceptance (report layout) ----------

/**
 * Line-scan end-to-end scenarios on the report layout (4 oblique area
 * readers + TOP/BOTTOM encoder-synced line scanners, GAP bottom
 * transfer). The oblique readers are too soft to decode at 0.4 mm
 * modules, so every decode in these runs comes from the line scanners —
 * the assertions are unambiguous.
 *
 * Seed 7 is pinned: it yields 5 top-face and 7 bottom-face labels over
 * 10 parcels (probed; other seeds can have zero top labels).
 */
describe('t7: line-scan e2e acceptance (report layout)', () => {
  // Final report layout (t1-preset8): six side readers + TOP/BOTTOM line
  // scanners. Line scanner ids are CAM-007/CAM-008 in that layout.
  const TOP = 'CAM-007';
  const BOTTOM = 'CAM-008';

  function lineCfg(seed = 7): SimConfig {
    const cfg = reportEightReaderConfig();
    cfg.seed = seed;
    cfg.parcel.tapeChance = 0;
    cfg.parcel.labelDamageChance = 0;
    return cfg;
  }

  function lineObs(rec: ReturnType<ProcessRun['record']>, face?: string) {
    return rec.observations.filter(
      (o) => o.acquisitionKind === 'LINE_SCAN' && (face === undefined || o.face === face),
    );
  }

  function lineEvents(rec: ReturnType<ProcessRun['record']>) {
    return rec.simEvents.filter(
      (e): e is Extract<(typeof rec.simEvents)[number], { type: `LINE_SCAN_${string}` }> => e.type.startsWith('LINE_SCAN'),
    );
  }

  function bottomLineRig(cfg: SimConfig): LineScanCameraConfig {
    const rig = cfg.cameraRigs.find(
      (r): r is LineScanCameraConfig => r.role === 'BOTTOM' && r.kind === 'LINE_SCAN',
    );
    if (!rig) throw new Error('report layout has no BOTTOM line scanner');
    return rig;
  }

  it('baseline: TOP decodes every top label 100%; BOTTOM decodes through the gap', () => {
    const run = new ProcessRun(lineCfg(), 10);
    run.runToCompletion();
    const rec = run.record();

    // Ground truth for the pinned seed.
    const gt = new Map(rec.groundTruth.map((g) => [g.parcelId, g.spec]));
    const topLabels: string[] = [];
    const bottomLabels: string[] = [];
    for (const [id, spec] of gt) {
      for (const l of spec.labels) {
        if (l.face === 'TOP') topLabels.push(`${id}:${l.labelInstanceId}`);
        if (l.face === 'BOTTOM') bottomLabels.push(`${id}:${l.labelInstanceId}`);
      }
    }
    expect(topLabels.length).toBeGreaterThan(0);
    expect(bottomLabels.length).toBeGreaterThan(0);

    // The BOTTOM scan plane sits over the 100 mm GAP opening (station
    // centre): every bottom strip is observable, and all decode.
    const bottomRig = bottomLineRig(rec.config);
    expect(bottomRig.line.scanPlaneZMm).toBe(rec.config.station.lengthMm / 2);

    const topObs = lineObs(rec, 'TOP');
    const botObs = lineObs(rec, 'BOTTOM');
    // Deterministic 100% read on both planes: exactly one observation per
    // top/bottom label instance, all decoded.
    expect([...topObs.map((o) => `${o.parcelId}:${o.labelInstanceId}`)].sort()).toEqual(
      [...topLabels].sort(),
    );
    expect([...botObs.map((o) => `${o.parcelId}:${o.labelInstanceId}`)].sort()).toEqual(
      [...bottomLabels].sort(),
    );
    expect(topObs.every((o) => o.decoded)).toBe(true);
    expect(botObs.every((o) => o.decoded)).toBe(true);

    // Each strip is one complete, encoder-aligned pass over the parcel
    // length (600 mm ± one 5 ms step).
    for (const o of [...topObs, ...botObs]) {
      expect(o.complete, o.frameId).toBe(true);
      expect(o.abortReason).toBeUndefined();
      const travelMm = o.encoderEndMm! - o.encoderStartMm!;
      expect(travelMm).toBeGreaterThanOrEqual(600);
      expect(travelMm).toBeLessThan(610);
      expect(o.lineCount).toBeGreaterThan(0);
      expect(o.ppm).toBeGreaterThan(rec.config.quality.ppmMin);
    }
  });

  it('solid deck: bottom plane off the gap yields zero bottom reads', () => {
    const cfg = lineCfg();
    bottomLineRig(cfg).line.scanPlaneZMm = 300; // solid deck (GAP opening centred at L/2)
    const run = new ProcessRun(cfg, 10);
    run.runToCompletion();
    const rec = run.record();

    // The bottom strips still run (sessions complete) but the deck blocks
    // the face: nothing observed, nothing decoded — never a fabricated read.
    expect(lineObs(rec, 'BOTTOM')).toEqual([]);
    const bottomTerminal = lineEvents(rec).filter(
      (e) => e.cameraId === BOTTOM && e.type !== 'LINE_SCAN_STARTED',
    );
    expect(bottomTerminal).toHaveLength(10);
    // TOP is unaffected: every top label still decodes.
    const topObs = lineObs(rec, 'TOP');
    expect(topObs.length).toBeGreaterThan(0);
    expect(topObs.every((o) => o.decoded)).toBe(true);
  });

  it('mid-run TOP fault: the open strip aborts; later parcels get no strip', () => {
    const run = new ProcessRun(lineCfg(), 10);
    // 11.8 s: mid-strip of P-0004 (the first top-labelled parcel; its
    // front crossed the plane at 11.7 s). P-0005..P-0009 are top-labelled.
    run.stepMany(2360);
    run.sim.state.cameraStates[TOP] = 'FAULT';
    run.runToCompletion();
    const rec = run.record();

    // Exactly one aborted strip, the one open at the fault: incomplete,
    // CAMERA_FAULT, and its top labels decode nothing.
    const aborted = lineEvents(rec).filter(
      (e): e is Extract<typeof e, { type: 'LINE_SCAN_ABORTED' }> =>
        e.type === 'LINE_SCAN_ABORTED' && e.cameraId === TOP,
    );
    expect(aborted).toHaveLength(1);
    expect(aborted[0].parcelId).toBe('P-0004');
    expect(aborted[0].reason).toBe('CAMERA_FAULT');
    expect(aborted[0].complete).toBe(false);
    // A full 600 mm parcel at 0.1 mm/line is ~6000 lines; the fault cut
    // the strip far short.
    expect(aborted[0].lineCount).toBeLessThan(6000);

    // A faulted scanner stops starting new strips: the post-fault
    // top-labelled parcels produce no TOP events at all.
    const topStarted = lineEvents(rec).filter(
      (e): e is Extract<typeof e, { type: 'LINE_SCAN_STARTED' }> =>
        e.type === 'LINE_SCAN_STARTED' && e.cameraId === TOP,
    );
    expect(topStarted.map((e) => e.parcelId)).toEqual([
      'P-0000', 'P-0001', 'P-0002', 'P-0003', 'P-0004',
    ]);

    // No fabricated reads: zero decoded top observations in the whole run,
    // and every top label instance is undecoded in the results.
    expect(lineObs(rec, 'TOP').filter((o) => o.decoded)).toHaveLength(0);
    const topObs = lineObs(rec, 'TOP');
    expect(topObs).toHaveLength(1);
    expect(topObs[0].parcelId).toBe('P-0004');
    expect(topObs[0].decoded).toBe(false);
    expect(topObs[0].complete).toBe(false);
    expect(topObs[0].abortReason).toBe('CAMERA_FAULT');
    expect(topObs[0].reasons).toEqual(['CAMERA_FAULT']);
    for (const r of rec.results) {
      const spec = rec.groundTruth.find((g) => g.parcelId === r.parcelId)!.spec;
      for (const l of spec.labels) {
        if (l.face !== 'TOP') continue;
        const lr = r.labelResults.find((x) => x.labelInstanceId === l.labelInstanceId);
        expect(lr?.decoded, `${r.parcelId}:${l.labelInstanceId}`).toBe(false);
      }
    }
    // The BOTTOM line scanner is unaffected by the TOP fault.
    expect(lineObs(rec, 'BOTTOM').every((o) => o.decoded)).toBe(true);
    expect(lineObs(rec, 'BOTTOM')).toHaveLength(7);
  });

  it('speed change to 1.5 m/s: undersampled strips fail LOW_PPM, no decode', () => {
    const run = new ProcessRun(lineCfg(), 10);
    run.stepMany(1200); // 6 s at 1 m/s, then over-sample → under-sample
    run.sim.state.speedMmPerSec = 1500; // 15 000 lines/s > 12 000 cap
    run.runToCompletion();
    const rec = run.record();

    // Seed 7 puts all 5 top labels on parcels crossing after the change.
    const topObs = lineObs(rec, 'TOP');
    expect(topObs.length).toBeGreaterThan(0);
    for (const o of topObs) {
      expect(o.simTimeMs, o.frameId).toBeGreaterThan(6000);
      // The strip itself is complete — the sampling gate is what fails.
      expect(o.complete, o.frameId).toBe(true);
      expect(o.decoded, o.frameId).toBe(false);
      expect(o.reasons, o.frameId).toContain('LOW_PPM');
    }
    // No top label instance decodes in the whole run.
    for (const r of rec.results) {
      const spec = rec.groundTruth.find((g) => g.parcelId === r.parcelId)!.spec;
      for (const l of spec.labels) {
        if (l.face !== 'TOP') continue;
        const lr = r.labelResults.find((x) => x.labelInstanceId === l.labelInstanceId);
        expect(lr?.decoded, `${r.parcelId}:${l.labelInstanceId}`).toBe(false);
        expect(lr?.reasons, `${r.parcelId}:${l.labelInstanceId}`).toContain('LOW_PPM');
      }
    }
  });

  it('close spacing: sessions never interleave; aborts carry CLOSE_SPACING', () => {
    const cfg = lineCfg();
    cfg.parcel.spawnIntervalMs = 400; // 400 mm front-to-front < 600 mm parcel
    const run = new ProcessRun(cfg, 10);
    run.runToCompletion();
    const rec = run.record();

    for (const cam of [TOP, BOTTOM]) {
      const terminal = lineEvents(rec).filter(
        (e): e is Extract<
          (typeof rec.simEvents)[number],
          { type: 'LINE_SCAN_COMPLETED' | 'LINE_SCAN_ABORTED' }
        > =>
          (e.type === 'LINE_SCAN_COMPLETED' || e.type === 'LINE_SCAN_ABORTED') &&
          e.cameraId === cam,
      );
      // Bounded: exactly one terminal event per parcel per rig.
      expect(terminal).toHaveLength(10);
      // Encoder intervals are pairwise disjoint: lines are never
      // interleaved between parcels.
      const sorted = [...terminal].sort((a, b) => a.encoderStartMm - b.encoderStartMm);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].encoderStartMm).toBeGreaterThanOrEqual(sorted[i - 1].encoderEndMm);
      }
      // Every abort is the close-spacing policy decision, never an error.
      for (const e of terminal) {
        if (e.type === 'LINE_SCAN_ABORTED') expect(e.reason).toBe('CLOSE_SPACING');
      }
    }

    // Incomplete strips decode nothing; decoded strips are complete.
    const obs = lineObs(rec);
    expect(obs.filter((o) => o.decoded).every((o) => o.complete)).toBe(true);
    expect(obs.filter((o) => !o.complete).every((o) => !o.decoded)).toBe(true);
    expect(obs.some((o) => o.decoded)).toBe(true); // some parcels strip clean
  });

  it('bounded events: 10 parcels → 4 line-scan events each, never per-line', () => {
    const run = new ProcessRun(lineCfg(), 10);
    run.runToCompletion();
    const rec = run.record();

    // 2 rigs × (1 STARTED + 1 terminal) × 10 parcels = O(parcels).
    const events = lineEvents(rec);
    expect(events).toHaveLength(40);

    // The same runs acquire tens of thousands of lines — the event stream
    // is bounded, not per-line (NFR-006).
    const totalLines = events
      .filter((e): e is Extract<typeof e, { type: 'LINE_SCAN_COMPLETED' }> =>
        e.type === 'LINE_SCAN_COMPLETED')
      .reduce((sum, e) => sum + e.lineCount, 0);
    expect(totalLines).toBeGreaterThan(10000);
    expect(events.length).toBeLessThan(totalLines / 100);

    // Each parcel crosses both planes exactly once (two terminal events).
    const perParcel = new Map<string, number>();
    for (const e of events) {
      if (e.type === 'LINE_SCAN_STARTED') continue;
      perParcel.set(e.parcelId, (perParcel.get(e.parcelId) ?? 0) + 1);
    }
    expect(perParcel.size).toBe(10);
    for (const n of perParcel.values()) expect(n).toBe(2);
  });
});

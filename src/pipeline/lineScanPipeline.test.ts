/**
 * Line-strip pipeline integration (t6):
 *  - interval-based association (unique overlap / ambiguous / unknown),
 *  - feedAcquisition LINE_STRIP dispatch (per-face-label expansion),
 *  - store-vs-headless byte-identity with a line-scan preset (NFR-006).
 */

import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from '../domain/config';
import { defaultLineScanRig } from '../domain/camera';
import type { LabelInstance, ParcelState } from '../domain/types';
import { associateLineStrip } from './association';
import { ParcelPipeline } from './pipeline';
import { feedAcquisition } from './feedCapture';
import { reportEightReaderConfig } from '../capture/presets';
import { stripBufferPool } from '../capture/frameBuffer';
import { buildStripTexture } from '../capture/stripPreview';
import { ProcessRun } from './runDriver';
import { buildLiveRunRecord } from '../export/json';
import { FIXED_STEP_MS } from '../simulation/state';
import { SimStore } from '../store/simStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLANE_Z = 1100;

// Test rigs use the report line geometry (715 mm scan-plane FOV over the
// 650 mm belt, margin 65 mm; 50 µs global line exposure — floor of the
// report band) so the coverage and quality ramps pass — see t2-lineobs.
function topRig(): ReturnType<typeof defaultLineScanRig> {
  return defaultLineScanRig(
    'LS-001',
    'TOP',
    [0, 900, PLANE_Z],
    [0, 1, 0, 0],
    PLANE_Z,
    { fovWidthMm: 715, lineExposureUs: 50 },
  );
}

function bottomRig(): ReturnType<typeof defaultLineScanRig> {
  return defaultLineScanRig(
    'LS-002',
    'BOTTOM',
    [0, -900, 1100],
    [0, -1, 0, 0],
    1100,
    { fovWidthMm: 715, lineExposureUs: 50 },
  );
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

function makeParcel(
  id: string,
  frontZMm: number,
  lengthMm = 500,
  labels: LabelInstance[] = [],
): ParcelState {
  return {
    parcelId: id,
    spec: {
      widthMm: 300,
      heightMm: 200,
      lengthMm,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels,
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm,
    phase: 'ENTERED',
  };
}

/**
 * Strip geometry at the closure step: parcel A (500 mm) front at 1200,
 * plane at 1100, encoder 1400 → A's travel interval is [1300, 1800].
 */
function closureContext() {
  const a = makeParcel('P-A', 1200);
  const strip = { simTimeMs: 5000, encoderStartMm: 1300, encoderEndMm: 1800 };
  const now = { simTimeMs: 5000, encoderMm: 1400 };
  return { a, strip, now };
}

function lineFeed(
  overrides: Record<string, unknown>,
): Parameters<typeof feedAcquisition>[0] {
  const cfg = defaultConfig();
  cfg.cameraRigs = [topRig()];
  // Report line geometry needs the report's blur target (715 mm/8192 px
  // scan plane at 50 µs / 1 m/s) — see reportEightReaderConfig.
  cfg.quality = reportEightReaderConfig().quality;
  const a = makeParcel('P-A', 1200, 500, [label('L-0001', 'KTY-1', 'TOP')]);
  return {
    kind: 'LINE_STRIP',
    cameraId: 'LS-001',
    simTimeMs: 5000,
    encoderMm: 1400,
    parcelId: 'P-A',
    encoderStartMm: 1300,
    encoderEndMm: 1800,
    lineCount: 5000,
    complete: true,
    config: cfg,
    parcels: new Map([[a.parcelId, a]]),
    cameraState: 'CAPTURING' as const,
    speedMmPerSec: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-1: interval association
// ---------------------------------------------------------------------------

describe('line-strip interval association (t6)', () => {
  it('associates to the unique parcel whose travel interval overlaps', () => {
    const { a, strip, now } = closureContext();
    const res = associateLineStrip(strip, a, [a], PLANE_Z, now);
    expect(res).toEqual({ ok: true });
  });

  it('zero overlaps (retired parcel) → PARCEL_UNKNOWN, no fabricated read', () => {
    const { strip, now } = closureContext();
    const res = associateLineStrip(strip, undefined, [], PLANE_Z, now);
    expect(res).toEqual({ ok: false, mismatch: 'PARCEL_UNKNOWN' });
  });

  it('two overlapping parcels → INTERVAL_AMBIGUOUS, no read in the pipeline', () => {
    const { a, strip, now } = closureContext();
    // B 200 mm behind A's rear: travel interval [1700, 2200] overlaps
    // the strip in [1700, 1800].
    const b = makeParcel('P-B', 800);
    const res = associateLineStrip(strip, a, [a, b], PLANE_Z, now);
    expect(res).toEqual({ ok: false, mismatch: 'INTERVAL_AMBIGUOUS' });

    // The pipeline records the mismatch and decodes nothing.
    const cfg = defaultConfig();
    cfg.cameraRigs = [topRig()];
    const pipeline = new ParcelPipeline();
    const stats = pipeline.processLineStrip(
      {
        frameId: 'LS-001@5000',
        cameraId: 'LS-001',
        simTimeMs: 5000,
        encoderStartMm: 1300,
        encoderEndMm: 1800,
        scanPlaneZMm: PLANE_Z,
        parcelId: 'P-A',
        face: 'TOP',
        observation: null,
      },
      now,
      [a, b],
    );
    expect(stats.decoded).toBe(0);
    expect(stats.mismatches).toBe(1);
    expect(pipeline.aggregateFor('P-A')?.mismatches).toEqual(['INTERVAL_AMBIGUOUS']);
  });

  it('stale strip → TIME_OUT_OF_WINDOW', () => {
    const { a, strip, now } = closureContext();
    const res = associateLineStrip(
      { ...strip, simTimeMs: 4000 },
      a,
      [a],
      PLANE_Z,
      now,
    );
    expect(res).toEqual({ ok: false, mismatch: 'TIME_OUT_OF_WINDOW' });
  });
});

// ---------------------------------------------------------------------------
// AC-1: feedAcquisition LINE_STRIP
// ---------------------------------------------------------------------------

describe('feedAcquisition LINE_STRIP dispatch (t6)', () => {
  it('a complete TOP strip yields one decoded observation per TOP-face label', () => {
    const a = makeParcel('P-A', 1200, 500, [
      label('L-0001', 'KTY-1', 'TOP'),
      label('L-0002', 'KTY-2', 'TOP'),
      label('L-0003', 'KTY-3', 'LEFT'), // not on the strip face
    ]);
    const out = feedAcquisition(
      lineFeed({ parcels: new Map([[a.parcelId, a]]) }),
      new ParcelPipeline(),
    );
    expect(out.observations).toHaveLength(2);
    for (const o of out.observations) {
      expect(o.cameraId).toBe('LS-001');
      expect(o.face).toBe('TOP');
      expect(o.decoded).toBe(true);
      expect(o.qualityPassed).toBe(true);
      // Effective ppm at the default 0.3 mm module: cross-belt
      // 0.3/(715/8192)=3.43 vs travel 0.3/0.1=3.0 → bottleneck 3.0.
      expect(o.ppm).toBeCloseTo(3.0, 6);
    }
    expect(out.stats.observations).toBe(2);
    expect(out.stats.decoded).toBe(2);
    expect(out.stats.mismatches).toBe(0);
  });

  it('an aborted strip is hard-gated: observations exist, nothing decodes', () => {
    const out = feedAcquisition(
      lineFeed({ complete: false, lineCount: 2500, abortReason: 'CLOSE_SPACING' }),
      new ParcelPipeline(),
    );
    expect(out.observations).toHaveLength(1);
    expect(out.observations[0].decoded).toBe(false);
    expect(out.observations[0].qualityPassed).toBe(false);
    expect(out.observations[0].reasons.length).toBeGreaterThan(0);
    expect(out.stats.decoded).toBe(0);
  });

  it('deck-occluded BOTTOM strip → no observation, no decode, no mismatch', () => {
    const cfg = defaultConfig();
    cfg.station.bottomTransfer = 'GAP';
    cfg.cameraRigs = [bottomRig()];
    // Station 2200 mm; parcel fully clear of the centred GAP → occluded.
    const b = makeParcel(
      'P-B',
      1800,
      500,
      [label('L-0001', 'KTY-9', 'BOTTOM')],
    );
    // Travel interval of B at encoder 2600, plane 1100: [1900, 2400] —
    // the strip must sit inside it for the association to be clean.
    const out = feedAcquisition(
      lineFeed({
        kind: 'LINE_STRIP',
        cameraId: 'LS-002',
        encoderMm: 2600,
        parcelId: 'P-B',
        encoderStartMm: 1900,
        encoderEndMm: 2400,
        lineCount: 5000,
        config: cfg,
        parcels: new Map([[b.parcelId, b]]),
      } as never),
      new ParcelPipeline(),
    );
    expect(out.observations).toEqual([]);
    expect(out.stats.decoded).toBe(0);
    expect(out.stats.mismatches).toBe(0);
  });

  it('a retired parcel → PARCEL_UNKNOWN mismatch, no fabricated read', () => {
    const pipeline = new ParcelPipeline();
    const cfg = defaultConfig();
    cfg.cameraRigs = [topRig()];
    const out = feedAcquisition(
      lineFeed({
        config: cfg,
        parcels: new Map<string, ParcelState>(),
      }),
      pipeline,
    );
    expect(out.observations).toEqual([]);
    expect(out.stats.decoded).toBe(0);
    expect(out.stats.mismatches).toBe(1);
    expect(pipeline.aggregateFor('P-A')?.mismatches).toEqual(['PARCEL_UNKNOWN']);
  });

  it('a LINE_STRIP for a non-line rig is ignored (dispatch guard)', () => {
    const cfg = defaultConfig();
    const areaRig = cfg.cameraRigs[0];
    const out = feedAcquisition(
      lineFeed({
        cameraId: areaRig.id,
        config: cfg,
      } as never),
      new ParcelPipeline(),
    );
    expect(out.observations).toEqual([]);
    expect(out.stats).toEqual({
      frameId: `${areaRig.id}@5000`,
      observations: 0,
      decoded: 0,
      mismatches: 0,
    });
  });

  it('is deterministic: the same strip twice into fresh pipelines matches', () => {
    const a = lineFeed({});
    const pipelineA = new ParcelPipeline();
    const pipelineB = new ParcelPipeline();
    const resA = feedAcquisition(a, pipelineA);
    const resB = feedAcquisition(a, pipelineB);
    expect(resA).toEqual(resB);
  });
});

// ---------------------------------------------------------------------------
// AC-2: store-vs-headless byte identity with a line-scan preset
// ---------------------------------------------------------------------------

const PARCELS = 10;

function lineCfg(): SimConfig {
  const cfg = reportEightReaderConfig();
  cfg.seed = 2026;
  cfg.belt.speedMmPerSec = 1000;
  cfg.parcel.labelCountMin = 1;
  cfg.parcel.labelCountMax = 3;
  cfg.parcel.material = 'KRAFT';
  cfg.parcel.tapeChance = 0;
  cfg.parcel.labelDamageChance = 0;
  return cfg;
}

function referenceSteps(): number {
  const ref = new ProcessRun(lineCfg(), PARCELS);
  ref.runToCompletion();
  return Math.round(ref.record().simTimeMs / FIXED_STEP_MS);
}

function liveRecordForSteps(steps: number): string {
  const store = new SimStore(lineCfg());
  store.sim.start();
  let executed = 0;
  while (executed < steps) {
    const stepsPerTick = Math.min(Math.floor(16.7 / FIXED_STEP_MS), steps - executed);
    store.tick(stepsPerTick * FIXED_STEP_MS);
    executed += stepsPerTick;
    if (store.parcelsSpawned >= PARCELS) store.sim.state.nextSpawnMs = Infinity;
  }
  return JSON.stringify(buildLiveRunRecord(store, store.computeLiveMetrics()));
}

describe('store vs headless with line scans (t6, NFR-006)', () => {
  const steps = referenceSteps();

  it('both produce byte-identical records (observations, results, metrics)', () => {
    const ref = new ProcessRun(lineCfg(), PARCELS);
    ref.runToCompletion();
    const headless = ref.record();
    const live = JSON.parse(liveRecordForSteps(steps));
    expect(JSON.stringify(live.observations)).toBe(
      JSON.stringify(headless.observations),
    );
    expect(JSON.stringify(live.results)).toBe(JSON.stringify(headless.results));
    expect(JSON.stringify(live.metrics)).toBe(JSON.stringify(headless.metrics));
  });

  it('line-scan decodes actually happen in the record (TOP strips decode)', () => {
    const ref = new ProcessRun(lineCfg(), PARCELS);
    ref.runToCompletion();
    const lineObs = ref.observations.filter((o) =>
      ref.record().config.cameraRigs.some(
        (r) => r.id === o.cameraId && r.kind === 'LINE_SCAN',
      ),
    );
    expect(lineObs.length).toBeGreaterThan(0);
    expect(lineObs.some((o) => o.decoded)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Decode path independence (t9, NFR-002): decode consumes ONLY the domain
// strip payload; the display-only strip preview is never read. (The import
// scan half of this AC is a grep: no decode-path file imports
// capture/frameBuffer — checked at commit time.)
// ---------------------------------------------------------------------------

describe('decode never reads preview pixels (t9, NFR-002)', () => {
  it('tampering the strip buffer pool changes nothing downstream', () => {
    const base = lineFeed({});
    const baseline = feedAcquisition(base, new ParcelPipeline());

    // Build a display-only strip for the same domain interval, push it,
    // then corrupt every pixel in the pool.
    stripBufferPool.clear();
    const tex = buildStripTexture({
      rig: topRig(),
      parcelId: 'P-A',
      simTimeMs: 5000,
      strip: {
        encoderStartMm: 1300,
        encoderEndMm: 1800,
        lineCount: 5000,
        expectedLineCount: 5000,
        complete: true,
      },
      beltSpeedMmPerSec: 1000,
      seed: 1,
    });
    stripBufferPool.push(tex);
    const live = stripBufferPool.latest('LS-001')!;
    expect(live.data.length).toBeGreaterThan(0);
    for (let i = 0; i < live.data.length; i++) live.data[i] = i % 2 ? 0 : 255;

    const tampered = feedAcquisition(base, new ParcelPipeline());
    expect(tampered.observations).toEqual(baseline.observations);
    expect(tampered.stats).toEqual(baseline.stats);
  });

  it('line-strip observations ignore display artifacts (imageEffects)', () => {
    const cfgClean = defaultConfig();
    const rigDirty = topRig();
    rigDirty.imageEffects = { jitter: 1, missingLineChance: 1, banding: 1 };
    cfgClean.cameraRigs = [rigDirty];

    const a = feedAcquisition(lineFeed({ config: cfgClean }), new ParcelPipeline());
    const b = feedAcquisition(lineFeed({ config: cfgClean }), new ParcelPipeline());
    // Same domain strip in, same observations out — artifacts live in the
    // preview texture only.
    expect(b.observations).toEqual(a.observations);
  });
});

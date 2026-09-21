/**
 * Metrics unit tests (MET-001..MET-008): latency percentiles, breakdowns,
 * run metrics on synthetic inputs, and the immutable run record.
 */

import { describe, it, expect } from 'vitest';
import type {
  AreaScanCameraConfig,
  ParcelResult,
  ParcelState,
} from '../domain/types';
import { recommendedSixViewConfig } from '../capture/presets';
import {
  breakdownBy,
  angleBand,
  ppmBand,
  rotationBand,
} from './breakdowns';
import { percentiles, latencySummary } from './latency';
import { computeRunMetrics } from './metrics';
import { buildRunRecord, deepFreeze } from './runRecord';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function parcel(over: Partial<ParcelState> = {}): ParcelState {
  return {
    parcelId: 'P-1',
    spec: {
      widthMm: 400,
      heightMm: 400,
      lengthMm: 600,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [
        { labelInstanceId: 'L-1', payload: 'KTY-11111111111111', face: 'LEFT', localOffsetMm: [0, 0], rotationDeg: 0, widthMm: 78, heightMm: 25, damage: 0 },
        { labelInstanceId: 'L-2', payload: 'KTY-22222222222222', face: 'TOP', localOffsetMm: [0, 0], rotationDeg: 0, widthMm: 78, heightMm: 25, damage: 0 },
      ],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm: 1100,
    phase: 'ENTERED',
    ...over,
  };
}

function result(
  parcelId: string,
  over: Partial<ParcelResult> = {},
): ParcelResult {
  return {
    parcelId,
    status: 'OK',
    expectedLabels: 2,
    decodedLabels: 2,
    uniquePayloads: 2,
    payloads: ['KTY-11111111111111', 'KTY-22222222222222'],
    labelResults: [
      {
        labelInstanceId: 'L-1',
        face: 'LEFT',
        payload: 'KTY-11111111111111',
        decodedPayload: 'KTY-11111111111111',
        decoded: true,
        bestConfidence: 1,
        observationCount: 12,
        decodedCount: 12,
        cameras: ['CAM-003'],
        reasons: [],
      },
      {
        labelInstanceId: 'L-2',
        face: 'TOP',
        payload: 'KTY-22222222222222',
        decodedPayload: 'KTY-22222222222222',
        decoded: true,
        bestConfidence: 1,
        observationCount: 40,
        decodedCount: 38,
        cameras: ['CAM-005'],
        reasons: [],
      },
    ],
    entrySimTimeMs: 1000,
    exitSimTimeMs: 3000,
    finalizedSimTimeMs: 3100,
    entryToResultMs: 2100,
    exitToResultMs: 100,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// latency
// ---------------------------------------------------------------------------

describe('percentiles (MET-006)', () => {
  it('empty input → zeros', () => {
    expect(percentiles([])).toEqual({ n: 0, p50: 0, p95: 0, p99: 0 });
  });

  it('nearest-rank on 1..100', () => {
    const p = percentiles(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(p.n).toBe(100);
    expect(p.p50).toBe(50);
    expect(p.p95).toBe(95);
    expect(p.p99).toBe(99);
  });

  it('single value', () => {
    const p = percentiles([42]);
    expect(p).toEqual({ n: 1, p50: 42, p95: 42, p99: 42 });
  });

  it('summary covers all four stages', () => {
    const s = latencySummary({
      captureToDecodeMs: [],
      entryToResultMs: [100, 200],
      exitToResultMs: [50],
      exitToAckMs: [120, 130, 140],
    });
    expect(s.captureToDecodeMs.n).toBe(0);
    expect(s.entryToResultMs.p50).toBe(100);
    expect(s.exitToResultMs.p99).toBe(50);
    expect(s.exitToAckMs.p99).toBe(140);
  });
});

// ---------------------------------------------------------------------------
// breakdowns
// ---------------------------------------------------------------------------

describe('breakdowns (MET-007)', () => {
  it('breakdownBy groups and sorts rows', () => {
    const rows = breakdownBy([
      { key: 'b', decoded: true },
      { key: 'a', decoded: false },
      { key: 'b', decoded: false },
      { key: 'a', decoded: true },
    ]);
    expect(rows).toEqual([
      { key: 'a', total: 2, decoded: 1, readRate: 0.5 },
      { key: 'b', total: 2, decoded: 1, readRate: 0.5 },
    ]);
  });

  it('empty input → no rows', () => {
    expect(breakdownBy([])).toEqual([]);
  });

  it('ppm bands', () => {
    expect(ppmBand(1.5)).toBe('<2');
    expect(ppmBand(2.5)).toBe('2-3');
    expect(ppmBand(4)).toBe('3-5');
    expect(ppmBand(7)).toBe('>=5');
  });

  it('angle bands', () => {
    expect(angleBand(10)).toBe('<20');
    expect(angleBand(30)).toBe('20-35');
    expect(angleBand(45)).toBe('35-60');
    expect(angleBand(75)).toBe('>=60');
  });

  it('rotation bands fold into 180° and bucket by 45°', () => {
    expect(rotationBand(0)).toBe('0-45');
    expect(rotationBand(44)).toBe('0-45');
    expect(rotationBand(89)).toBe('45-90');
    expect(rotationBand(90)).toBe('90-135');
    expect(rotationBand(200)).toBe('0-45'); // folds 200 → 20
    expect(rotationBand(315)).toBe('135-180');
  });
});

// ---------------------------------------------------------------------------
// run metrics
// ---------------------------------------------------------------------------

describe('computeRunMetrics (MET-001..005, 007)', () => {
  it('full read on a clean parcel', () => {
    const p = parcel();
    const r = result('P-1');
    const m = computeRunMetrics({
      parcels: [{ parcel: p, result: r, aggregate: undefined }],
      observations: [
        { cameraId: 'CAM-003', parcelId: 'P-1', labelInstanceId: 'L-1', face: 'LEFT', material: 'KRAFT', rotationDeg: 0, ppm: 4, incidenceDeg: 10, decoded: true, reasons: [] },
        { cameraId: 'CAM-005', parcelId: 'P-1', labelInstanceId: 'L-2', face: 'TOP', material: 'KRAFT', rotationDeg: 0, ppm: 5, incidenceDeg: 5, decoded: true, reasons: [] },
      ],
    });
    expect(m.evaluatedParcels).toBe(1);
    expect(m.completeReadRate).toBe(1);
    expect(m.barcodeRecall).toBe(1);
    expect(m.barcodePrecision).toBe(1);
    expect(m.correctDecodes).toBe(2);
    expect(m.falseDecodes).toBe(0);
    expect(m.misassociations).toBe(0);
    expect(m.totalObservations).toBe(52); // 12 + 40
    expect(m.uniqueObservedInstances).toBe(2);
    expect(m.observationsCollapsed).toBe(50);
    expect(m.latency.exitToResultMs.p50).toBe(100);
    expect(m.latency.exitToAckMs.n).toBe(0);
    expect(m.breakdowns.camera.map((x) => x.key)).toEqual(['CAM-003', 'CAM-005']);
    expect(m.breakdowns.face.map((x) => x.key)).toEqual(['LEFT', 'TOP']);
  });

  it('partial read drops rates; ghost decode drops precision (MET-003/004a)', () => {
    const p = parcel();
    const ghostResult = result('P-1', {
      status: 'PARTIAL',
      decodedLabels: 1,
      payloads: ['KTY-11111111111111'],
      labelResults: [
        {
          labelInstanceId: 'L-1',
          face: 'LEFT',
          payload: 'KTY-11111111111111',
          decodedPayload: 'KTY-11111111111111',
          decoded: true,
          bestConfidence: 1,
          observationCount: 5,
          decodedCount: 5,
          cameras: ['CAM-003'],
          reasons: [],
        },
        {
          labelInstanceId: 'GHOST-9',
          face: 'RIGHT',
          payload: 'KTY-99999999999999',
          decodedPayload: 'KTY-99999999999999',
          decoded: true,
          bestConfidence: 0.9,
          observationCount: 2,
          decodedCount: 2,
          cameras: ['CAM-004'],
          reasons: [],
        },
      ],
    });
    const m = computeRunMetrics({
      parcels: [
        {
          parcel: p,
          result: ghostResult,
          aggregate: {
            parcelId: 'P-1',
            labels: [],
            mismatches: ['GHOST_INSTANCE', 'GHOST_INSTANCE'],
          },
        },
      ],
      observations: [],
    });
    expect(m.completeReadRate).toBe(0);
    expect(m.barcodeRecall).toBe(0.5);
    expect(m.barcodePrecision).toBe(0.5); // 1 correct of 2 decoded
    expect(m.falseDecodes).toBe(1);
    expect(m.misassociations).toBe(2);
    expect(m.breakdowns.reason).toEqual([]);
  });

  it('unfinalized parcels are not evaluated', () => {
    const m = computeRunMetrics({
      parcels: [{ parcel: parcel(), result: undefined, aggregate: undefined }],
      observations: [],
    });
    expect(m.evaluatedParcels).toBe(0);
    expect(m.completeReadRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MET-005: duplicateRate (observationsCollapsed / totalObservations)
// ---------------------------------------------------------------------------

describe('duplicateRate (MET-005)', () => {
  const lr = (
    id: string,
    payload: string,
    decoded: boolean,
    observationCount: number,
  ) => ({
    labelInstanceId: id,
    face: 'LEFT' as const,
    payload,
    decodedPayload: decoded ? payload : undefined,
    decoded,
    bestConfidence: decoded ? 1 : 0,
    observationCount,
    decodedCount: decoded ? observationCount : 0,
    cameras: ['CAM-003'],
    reasons: [] as string[],
  });

  it('empty run → 0, never NaN', () => {
    const m = computeRunMetrics({ parcels: [], observations: [] });
    expect(m.totalObservations).toBe(0);
    expect(m.uniqueObservedInstances).toBe(0);
    expect(m.observationsCollapsed).toBe(0);
    expect(m.duplicateRate).toBe(0);
    expect(Number.isNaN(m.duplicateRate)).toBe(false);
  });

  it('partial decode: redundant fraction over all observations', () => {
    // L-1 observed 10× (decoded), L-2 observed 3× (never decoded).
    const r = result('P-1', {
      status: 'PARTIAL',
      decodedLabels: 1,
      payloads: ['KTY-11111111111111'],
      labelResults: [lr('L-1', 'KTY-11111111111111', true, 10), lr('L-2', 'KTY-22222222222222', false, 3)],
    });
    const m = computeRunMetrics({
      parcels: [{ parcel: parcel(), result: r, aggregate: undefined }],
      observations: [],
    });
    expect(m.totalObservations).toBe(13);
    expect(m.uniqueObservedInstances).toBe(2);
    expect(m.observationsCollapsed).toBe(11);
    expect(m.duplicateRate).toBeCloseTo(11 / 13);
  });

  it('duplicates: multiple observations of one instance', () => {
    const r = result('P-1', {
      decodedLabels: 1,
      payloads: ['KTY-11111111111111'],
      labelResults: [lr('L-1', 'KTY-11111111111111', true, 7)],
    });
    const m = computeRunMetrics({
      parcels: [{ parcel: parcel(), result: r, aggregate: undefined }],
      observations: [],
    });
    expect(m.totalObservations).toBe(7);
    expect(m.uniqueObservedInstances).toBe(1);
    expect(m.observationsCollapsed).toBe(6);
    expect(m.duplicateRate).toBeCloseTo(6 / 7);
  });

  it('false decode (ghost): ghost observations count in the denominator', () => {
    const r = result('P-1', {
      decodedLabels: 2,
      uniquePayloads: 2,
      payloads: ['KTY-11111111111111', 'KTY-99999999999999'],
      labelResults: [
        lr('L-1', 'KTY-11111111111111', true, 2),
        lr('GHOST-9', 'KTY-99999999999999', true, 5),
      ],
    });
    const m = computeRunMetrics({
      parcels: [{ parcel: parcel(), result: r, aggregate: undefined }],
      observations: [],
    });
    expect(m.falseDecodes).toBe(1);
    expect(m.totalObservations).toBe(7);
    expect(m.uniqueObservedInstances).toBe(2);
    expect(m.observationsCollapsed).toBe(5);
    expect(m.duplicateRate).toBeCloseTo(5 / 7);
  });

  it('repeated payload on distinct instances: dedup keys on instance, not payload', () => {
    const same = 'KTY-00000000000000';
    const p = parcel({
      spec: {
        ...parcel().spec,
        labels: [
          { labelInstanceId: 'L-1', payload: same, face: 'LEFT', localOffsetMm: [0, 0], rotationDeg: 0, widthMm: 78, heightMm: 25, damage: 0 },
          { labelInstanceId: 'L-2', payload: same, face: 'TOP', localOffsetMm: [0, 0], rotationDeg: 0, widthMm: 78, heightMm: 25, damage: 0 },
        ],
      },
    });
    const r = result('P-1', {
      expectedLabels: 2,
      uniquePayloads: 1,
      payloads: [same],
      labelResults: [lr('L-1', same, true, 3), lr('L-2', same, true, 3)],
    });
    const m = computeRunMetrics({
      parcels: [{ parcel: p, result: r, aggregate: undefined }],
      observations: [],
    });
    expect(m.correctDecodes).toBe(2);
    expect(m.totalObservations).toBe(6);
    expect(m.uniqueObservedInstances).toBe(2); // keyed by instance, not payload
    expect(m.observationsCollapsed).toBe(4);
    expect(m.duplicateRate).toBeCloseTo(4 / 6);
  });
});

// ---------------------------------------------------------------------------
// run record (MET-008)
// ---------------------------------------------------------------------------

describe('run record (MET-008)', () => {
  it('buildRunRecord deep-freezes and JSON-round-trips', () => {
    const p = parcel();
    const record = buildRunRecord({
      runId: 'run-test',
      seed: 2026,
      processingMode: 'GEOMETRY_MODEL',
      config: recommendedSixViewConfig(),
      simTimeMs: 42000,
      encoderMm: 42000,
      groundTruth: [
        {
          parcelId: p.parcelId,
          spec: p.spec,
          spawnSimTimeMs: 0,
          entrySimTimeMs: 100,
          exitSimTimeMs: 3000,
        },
      ],
      frames: [{ frameId: 'CAM-003@100', cameraId: 'CAM-003', simTimeMs: 100, encoderMm: 100, candidateParcelIds: ['P-1'] }],
      observations: [],
      results: [result('P-1')],
      metrics: computeRunMetrics({
        parcels: [{ parcel: p, result: result('P-1'), aggregate: undefined }],
        observations: [],
      }),
      simEvents: [],
      pipelineEvents: [{ type: 'PARCEL_FINALIZED', parcelId: 'P-1', simTimeMs: 3100, status: 'OK' }],
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.metrics)).toBe(true);
    expect(Object.isFrozen(record.config)).toBe(true);
    // Immutability: assignment throws in strict mode.
    expect(() => {
      (record as { seed: number }).seed = 1;
    }).toThrow();
    // JSON round-trip preserves the audit fields.
    const again = JSON.parse(JSON.stringify(record));
    expect(again.seed).toBe(2026);
    expect(again.metrics.completeReadRate).toBe(1);
    expect(again.results[0].status).toBe('OK');
  });

  it('deepFreeze is recursive', () => {
    const obj = deepFreeze({ a: { b: [1, 2, 3] } });
    expect(Object.isFrozen(obj.a.b)).toBe(true);
  });

  it('late mutation of inputs cannot leak into the record', () => {
    const live = { note: 'mutable' };
    const record = buildRunRecord({
      runId: 'run-x',
      seed: 1,
      processingMode: 'GEOMETRY_MODEL',
      config: recommendedSixViewConfig(),
      simTimeMs: 0,
      encoderMm: 0,
      groundTruth: [],
      frames: [],
      observations: [],
      results: [],
      metrics: computeRunMetrics({ parcels: [], observations: [] }),
      simEvents: [],
      pipelineEvents: [],
    });
    (live as { note: string }).note = 'changed';
    expect(record.runId).toBe('run-x');
  });
});

// ---------------------------------------------------------------------------
// preset
// ---------------------------------------------------------------------------

describe('recommended 6-view preset', () => {
  it('produces six enabled rigs with distinct roles and f/22', () => {
    const cfg = recommendedSixViewConfig();
    expect(cfg.cameraRigs).toHaveLength(6);
    const roles = cfg.cameraRigs.map((r) => r.role).sort();
    expect(roles).toEqual(['BOTTOM', 'FRONT', 'LEFT', 'REAR', 'RIGHT', 'TOP']);
    for (const rig of cfg.cameraRigs as AreaScanCameraConfig[]) {
      expect(rig.enabled).toBe(true);
      expect(rig.optics.apertureProxy).toBe(22);
      expect(rig.acquisition.focusDistanceMm).toBeGreaterThan(0);
    }
    expect(cfg.barcode.xDimensionMm).toBe(1.1);
    expect(cfg.parcel.tapeChance).toBe(0);
  });
});

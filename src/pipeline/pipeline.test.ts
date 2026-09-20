/**
 * Pipeline tests (PIPE-006..PIPE-009, REV-05, REV-10): decode, association,
 * dedup, finalize policy, and an end-to-end frame → result through the real
 * observation engine.
 */

import { defaultCameraRigs, lookAtQuaternion, toCameraSpace } from '../domain/camera';
import { defaultConfig } from '../domain/config';
import type { SimConfig } from '../domain/config';
import type {
  AreaScanCameraConfig,
  AssociationMismatch,
  CameraConfig,
  LabelInstance,
  ParcelState,
} from '../domain/types';
import { observeLabels, type LabelObservationResult, type ObserveContext } from '../observation/observationEngine';
import { exitToAckMs } from '../domain/events';
import { decodeObservation } from './decoder';
import { associateObservation, DEFAULT_ASSOCIATION_WINDOWS } from './association';
import { addObservation, newAggregate, type ParcelAggregate } from './aggregation';
import { finalizeParcel, parcelReadyToFinalize } from './finalize';
import { ParcelPipeline, type PipelineFrame } from './pipeline';

// ---------- fixtures ----------

const STATION = { lengthMm: 2200, beltWidthMm: 650 };
const DEFAULTS = {
  sensorWidthPx: 5320,
  sensorHeightPx: 3032,
  focalLengthMm: 16,
  exposureUs: 75,
  fps: 20,
  shutter: 'GLOBAL' as const,
};

function leftRig(): AreaScanCameraConfig {
  const rig = defaultCameraRigs(STATION, DEFAULTS).find((r) => r.role === 'LEFT')!;
  const eye: [number, number, number] = [-1200, 700, 1100];
  const target: [number, number, number] = [0, 400, 1100];
  const pose = { positionMm: eye, quaternion: lookAtQuaternion(eye, target) };
  const z = toCameraZ([-200, 400, 800], rig, pose);
  return { ...rig, pose, acquisition: { ...rig.acquisition, focusDistanceMm: z } };
}

function toCameraZ(
  p: [number, number, number],
  rig: CameraConfig,
  pose: { positionMm: [number, number, number]; quaternion: [number, number, number, number] },
): number {
  return toCameraSpace(p, { ...rig, pose })[2];
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

function label(id: string, payload: string, face: LabelInstance['face'] = 'LEFT'): LabelInstance {
  return {
    labelInstanceId: id,
    payload,
    face,
    localOffsetMm: [0, 200],
    rotationDeg: 0,
    widthMm: 78,
    heightMm: 25,
    damage: 0,
  };
}

function makeCfg(): SimConfig {
  const cfg = defaultConfig();
  cfg.barcode.xDimensionMm = 1.1;
  return cfg;
}

const OBS_DEFAULTS: LabelObservationResult = {
  parcelId: 'P-001',
  labelInstanceId: 'L-0001',
  face: 'LEFT',
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

/** Synthetic observation without running the engine. */
function obs(over: Partial<LabelObservationResult>): LabelObservationResult {
  return { ...OBS_DEFAULTS, ...over };
}

function frame(over: Partial<PipelineFrame>): PipelineFrame {
  return {
    frameId: 'F-1',
    cameraId: 'CAM-LEFT',
    cameraState: 'CAPTURING',
    simTimeMs: 1000,
    encoderPositionMm: 2000,
    candidateParcelIds: ['P-001'],
    labels: [],
    ...over,
  };
}

const NOW = { simTimeMs: 1000, encoderMm: 2000 };

// ---------- decoder ----------

describe('decodeObservation', () => {
  it('decodes the frame content when the quality model admitted it', () => {
    const d = decodeObservation(obs({}), { labelInstanceId: 'L-0001', payload: 'KTY-123' });
    expect(d.decoded).toBe(true);
    expect(d.decodedPayload).toBe('KTY-123');
  });

  it('returns no payload when quality gates reject', () => {
    const d = decodeObservation(
      obs({ qualityPassed: false, reasons: ['OCCLUDED'], confidence: 0.2 }),
      { labelInstanceId: 'L-0001', payload: 'KTY-123' },
    );
    expect(d.decoded).toBe(false);
    expect(d.decodedPayload).toBeUndefined();
    expect(d.confidence).toBe(0);
    expect(d.reasons).toEqual(['OCCLUDED']);
  });

  it('is deterministic', () => {
    const a = decodeObservation(obs({}), { labelInstanceId: 'L-0001', payload: 'X' });
    const b = decodeObservation(obs({}), { labelInstanceId: 'L-0001', payload: 'X' });
    expect(a).toEqual(b);
  });
});

// ---------- association ----------

describe('associateObservation', () => {
  const parcel = makeParcel();

  it('passes for a fresh, in-window observation', () => {
    const r = associateObservation(
      { parcelId: 'P-001', labelInstanceId: 'L-0001' },
      { cameraId: 'C', simTimeMs: 1000, encoderPositionMm: 2000 },
      { ...parcel, spec: { ...parcel.spec, labels: [label('L-0001', 'P')] }, entrySimTimeMs: 900 },
      NOW,
    );
    expect(r.ok).toBe(true);
  });

  it('PARCEL_UNKNOWN when the parcel is gone', () => {
    const r = associateObservation(
      { parcelId: 'P-999', labelInstanceId: 'L-0001' },
      { cameraId: 'C', simTimeMs: 1000, encoderPositionMm: 2000 },
      undefined,
      NOW,
    );
    expect(r).toEqual({ ok: false, mismatch: 'PARCEL_UNKNOWN' });
  });

  it('GHOST_INSTANCE when the instance is not on the parcel (REV-10)', () => {
    const r = associateObservation(
      { parcelId: 'P-001', labelInstanceId: 'L-999' },
      { cameraId: 'C', simTimeMs: 1000, encoderPositionMm: 2000 },
      { ...parcel, spec: { ...parcel.spec, labels: [label('L-0001', 'P')] } },
      NOW,
    );
    expect(r).toEqual({ ok: false, mismatch: 'GHOST_INSTANCE' });
  });

  it('POSITION_OUT_OF_WINDOW for a stale frame (REV-05)', () => {
    const r = associateObservation(
      { parcelId: 'P-001', labelInstanceId: 'L-0001' },
      { cameraId: 'C', simTimeMs: 1000, encoderPositionMm: 2000 - 200 }, // 200 mm behind now
      { ...parcel, spec: { ...parcel.spec, labels: [label('L-0001', 'P')] } },
      NOW,
    );
    expect(r).toEqual({ ok: false, mismatch: 'POSITION_OUT_OF_WINDOW' });
  });

  it('TIME_OUT_OF_WINDOW for an old timestamp', () => {
    const r = associateObservation(
      { parcelId: 'P-001', labelInstanceId: 'L-0001' },
      { cameraId: 'C', simTimeMs: 1000 - 400, encoderPositionMm: 2000 },
      { ...parcel, spec: { ...parcel.spec, labels: [label('L-0001', 'P')] } },
      NOW,
      { ...DEFAULT_ASSOCIATION_WINDOWS },
    );
    expect(r).toEqual({ ok: false, mismatch: 'TIME_OUT_OF_WINDOW' });
  });
});

// ---------- aggregation ----------

describe('aggregation', () => {
  it('collapses repeated observations of the same physical instance', () => {
    const agg = newAggregate('P-001');
    const triple = {
      parcelId: 'P-001',
      labelInstanceId: 'L-0001',
      face: 'LEFT' as const,
      payload: 'KTY-1',
      confidence: 1,
      reasons: [],
      simTimeMs: 1000,
      decode: { labelInstanceId: 'L-0001', decoded: true, decodedPayload: 'KTY-1', confidence: 0.9, reasons: [] },
      association: { ok: true },
    };
    addObservation(agg, { ...triple, cameraId: 'CAM-L' });
    addObservation(agg, { ...triple, cameraId: 'CAM-R', simTimeMs: 1050 });
    expect(agg.labels).toHaveLength(1);
    expect(agg.labels[0].observationCount).toBe(2);
    expect(agg.labels[0].decodedCount).toBe(2);
    expect(agg.labels[0].cameras).toEqual(['CAM-L', 'CAM-R']);
  });

  it('preserves identical payloads on different instances (REV-10)', () => {
    const agg = newAggregate('P-001');
    const base = {
      parcelId: 'P-001',
      face: 'LEFT' as const,
      cameraId: 'CAM-L',
      payload: 'SAME-PAYLOAD',
      confidence: 1,
      reasons: [],
      simTimeMs: 1000,
      decode: { labelInstanceId: '', decoded: true, decodedPayload: 'SAME-PAYLOAD', confidence: 1, reasons: [] },
      association: { ok: true },
    };
    addObservation(agg, { ...base, labelInstanceId: 'L-0001', decode: { ...base.decode, labelInstanceId: 'L-0001' } });
    addObservation(agg, { ...base, labelInstanceId: 'L-0002', face: 'RIGHT', decode: { ...base.decode, labelInstanceId: 'L-0002' } });
    expect(agg.labels).toHaveLength(2);
  });

  it('records mismatches without folding them into labels', () => {
    const agg = newAggregate('P-001');
    addObservation(agg, {
      parcelId: 'P-001',
      labelInstanceId: 'L-999',
      face: 'LEFT',
      payload: '',
      confidence: 1,
      reasons: [],
      cameraId: 'CAM-L',
      simTimeMs: 1000,
      decode: { labelInstanceId: 'L-999', decoded: true, decodedPayload: '', confidence: 1, reasons: [] },
      association: { ok: false, mismatch: 'GHOST_INSTANCE' },
    });
    expect(agg.labels).toHaveLength(0);
    expect(agg.mismatches).toEqual(['GHOST_INSTANCE']);
  });
});

// ---------- finalize ----------

describe('finalize policy', () => {
  const parcel = makeParcel({
    entrySimTimeMs: 500,
    exitSimTimeMs: 1500,
    spec: {
      ...makeParcel().spec,
      labels: [label('L-0001', 'A'), label('L-0002', 'B', 'RIGHT')],
    },
  });

  function fin(agg: ParcelAggregate, mismatches: AssociationMismatch[] = [], totals?: { total: number; faulted: number }) {
    return finalizeParcel({
      parcel,
      aggregate: { ...agg, mismatches: mismatches.length > 0 ? mismatches : agg.mismatches },
      simTimeMs: 1750,
      finalizeGraceMs: 250,
      totalObservations: totals?.total ?? agg.labels.length,
      faultedObservations: totals?.faulted ?? 0,
    });
  }

  function aggWith(decoded: string[], payloads: Record<string, string> = {}): ParcelAggregate {
    return {
      parcelId: 'P-001',
      labels: decoded.map((id) => ({
        labelInstanceId: id,
        face: 'LEFT' as const,
        payload: payloads[id] ?? id,
        decodedPayload: payloads[id] ?? id,
        decoded: true,
        bestConfidence: 1,
        observationCount: 1,
        decodedCount: 1,
        cameras: ['CAM-L'],
        reasons: [] as string[],
        firstObsMs: 1000,
        lastObsMs: 1000,
      })),
      mismatches: [] as AssociationMismatch[],
    };
  }

  it('grace: not ready before exit+grace, ready after', () => {
    expect(parcelReadyToFinalize(parcel, 1700, 250)).toBe(false);
    expect(parcelReadyToFinalize(parcel, 1750, 250)).toBe(true);
  });

  it('OK when every expected instance decoded', () => {
    const r = fin(aggWith(['L-0001', 'L-0002'], { 'L-0001': 'A', 'L-0002': 'B' }));
    expect(r.status).toBe('OK');
    expect(r.decodedLabels).toBe(2);
    expect(r.payloads).toEqual(['A', 'B']);
  });

  it('PARTIAL when only some decoded', () => {
    const r = fin(aggWith(['L-0001'], { 'L-0001': 'A' }));
    expect(r.status).toBe('PARTIAL');
    // The never-observed instance is still listed in labelResults:
    const missing = r.labelResults.find((l) => l.labelInstanceId === 'L-0002')!;
    expect(missing.decoded).toBe(false);
    expect(missing.reasons).toContain('NO_OBSERVATION');
  });

  it('NO_READ when nothing decoded', () => {
    const r = fin(aggWith([]));
    expect(r.status).toBe('NO_READ');
    expect(r.labelResults).toHaveLength(2);
  });

  it('AMBIGUOUS on any association mismatch', () => {
    const r = fin(aggWith(['L-0001', 'L-0002'], {}), ['GHOST_INSTANCE']);
    expect(r.status).toBe('AMBIGUOUS');
  });

  it('SENSOR_FAULT when all observations carried CAMERA_FAULT', () => {
    const r = fin(aggWith([]), [], { total: 4, faulted: 4 });
    expect(r.status).toBe('SENSOR_FAULT');
  });
});

// ---------- end-to-end through the real engine ----------

describe('pipeline end-to-end (engine → result)', () => {
  it('a readable label decodes, associates, and finalizes OK', () => {
    const cfg = makeCfg();
    const rig = leftRig();
    const parcel = makeParcel({
      entrySimTimeMs: 800,
      exitSimTimeMs: 1500,
      spec: { ...makeParcel().spec, labels: [label('L-0001', 'KTY-12345678901234')] },
    });
    const ctx: ObserveContext = { simTimeMs: 1000, speedMmPerSec: 1000 };
    const labels = observeLabels(rig, 'CAPTURING', [parcel], [parcel], ctx, cfg);
    expect(labels[0].qualityPassed).toBe(true); // readable baseline

    const pipe = new ParcelPipeline();
    const stats = pipe.processFrame(
      frame({ labels, encoderPositionMm: 2000, simTimeMs: 1000 }),
      NOW,
      [parcel],
    );
    expect(stats.observations).toBe(1);
    expect(stats.decoded).toBe(1);
    expect(stats.mismatches).toBe(0);

    expect(pipe.finalizeDue(1749, cfg, [parcel])).toHaveLength(0);
    const fresh = pipe.finalizeDue(1750, cfg, [parcel]);
    expect(fresh).toHaveLength(1);
    const r = fresh[0];
    expect(r.status).toBe('OK');
    expect(r.payloads).toEqual(['KTY-12345678901234']);
    expect(r.exitToResultMs).toBe(250);
    expect(pipe.events).toEqual([
      { type: 'PARCEL_FINALIZED', parcelId: 'P-001', simTimeMs: 1750, status: 'OK' },
    ]);

    // ACK stage: simulated PLC round trip after the configured latency.
    expect(pipe.ackDue(1799, cfg.ackLatencyMs)).toEqual([]);
    expect(pipe.ackDue(1800, cfg.ackLatencyMs)).toEqual(['P-001']);
    expect(pipe.ackDue(1801, cfg.ackLatencyMs)).toEqual([]); // acked once
    expect(r.ackSimTimeMs).toBe(1800);
    expect(exitToAckMs(r)).toBe(300); // exit 1500 → ack 1800
    expect(pipe.events).toEqual([
      { type: 'PARCEL_FINALIZED', parcelId: 'P-001', simTimeMs: 1750, status: 'OK' },
      { type: 'PARCEL_ACKED', parcelId: 'P-001', simTimeMs: 1800 },
    ]);
  });

  it('a blocked label produces NO_READ with reasons (not a crash)', () => {
    const cfg = makeCfg();
    const rig = leftRig();
    const parcel = makeParcel({
      entrySimTimeMs: 800,
      exitSimTimeMs: 1500,
      spec: { ...makeParcel().spec, labels: [label('L-0001', 'KTY-1')] },
    });
    // Tall occluder in front of the LEFT rig (same geometry as engine test):
    const blocker = makeParcel({
      parcelId: 'P-002',
      frontZMm: 1025,
      spec: { ...makeParcel().spec, widthMm: 400, heightMm: 600, lengthMm: 150, lateralOffsetMm: -700, labels: [] },
    });
    const labels = observeLabels(rig, 'CAPTURING', [parcel], [parcel, blocker], { simTimeMs: 1000, speedMmPerSec: 1000 }, cfg);
    expect(labels[0].qualityPassed).toBe(false);
    expect(labels[0].reasons).toContain('OCCLUDED');

    const pipe = new ParcelPipeline();
    pipe.processFrame(frame({ labels }), NOW, [parcel, blocker]);
    const r = pipe.finalizeDue(1750, cfg, [parcel])[0];
    expect(r.status).toBe('NO_READ');
    expect(r.labelResults[0].decoded).toBe(false);
    expect(r.labelResults[0].reasons).toContain('OCCLUDED');
  });

  it('frames only attribute parcels inside the candidate list', () => {
    const pipe = new ParcelPipeline();
    const labels = [obs({ parcelId: 'P-999', labelInstanceId: 'L-1' })];
    const stats = pipe.processFrame(
      frame({ candidateParcelIds: ['P-001'], labels }),
      NOW,
      [],
    );
    expect(stats.observations).toBe(0);
    expect(stats.decoded).toBe(0);
  });
});

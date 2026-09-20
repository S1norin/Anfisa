/**
 * Parcel timeline derivation (t11): spawned → entered → captured →
 * decoded → aggregated → finalized → PLC ACK from the event logs.
 */

import { describe, it, expect } from 'vitest';
import type { SimEvent } from '../../domain/types';
import type { ParcelAggregate } from '../../pipeline/aggregation';
import type { RunObservationMeta } from '../../metrics/runRecord';
import {
  parcelTimelineStages,
  currentTimelineStage,
  TIMELINE_STAGE_ORDER,
} from './timeline';

function obs(over: Partial<RunObservationMeta>): RunObservationMeta {
  return {
    frameId: 'F-1',
    cameraId: 'CAM-TOP',
    simTimeMs: 1000,
    parcelId: 'P-001',
    labelInstanceId: 'L-0001',
    face: 'TOP',
    material: 'KRAFT',
    rotationDeg: 0,
    ppm: 20,
    incidenceDeg: 10,
    confidence: 0.9,
    qualityPassed: true,
    decoded: false,
    reasons: [],
    ...over,
  };
}

function aggregate(
  firstObsMs: number | null,
): ParcelAggregate | undefined {
  if (firstObsMs === null) return undefined;
  return {
    parcelId: 'P-001',
    labels: [
      {
        labelInstanceId: 'L-0001',
        face: 'TOP',
        payload: 'KTY-1',
        decoded: true,
        decodedPayload: 'KTY-1',
        bestConfidence: 0.9,
        observationCount: 3,
        decodedCount: 3,
        cameras: ['CAM-TOP'],
        reasons: [],
        firstObsMs,
        lastObsMs: firstObsMs + 100,
      },
    ],
    mismatches: [],
  };
}

const BASE_EVENTS: SimEvent[] = [
  { type: 'RUN_RESET', simTimeMs: 0, seed: 1 },
  { type: 'PARCEL_SPAWNED', parcelId: 'P-001', simTimeMs: 100, encoderMm: 0 },
  { type: 'CAMERA_CAPTURED', cameraId: 'CAM-TOP', simTimeMs: 800, candidateParcelIds: ['P-002'] },
  { type: 'CAMERA_CAPTURED', cameraId: 'CAM-TOP', simTimeMs: 900, candidateParcelIds: ['P-001'] },
  { type: 'PARCEL_ENTERED', parcelId: 'P-001', simTimeMs: 200, encoderMm: 0 },
];

const BASE_PIPELINE: SimEvent[] = [
  { type: 'PARCEL_FINALIZED', parcelId: 'P-001', simTimeMs: 4000, status: 'OK' },
  { type: 'PARCEL_ACKED', parcelId: 'P-001', simTimeMs: 4050 },
];

describe('parcelTimelineStages', () => {
  it('derives all seven stages from the logs', () => {
    const stages = parcelTimelineStages({
      parcelId: 'P-001',
      parcel: {
        parcelId: 'P-001',
        spec: {
          widthMm: 100,
          heightMm: 100,
          lengthMm: 100,
          lateralOffsetMm: 0,
          yawDeg: 0,
          material: 'KRAFT',
          tape: false,
          labels: [],
        },
        spawnSimTimeMs: 100,
        spawnEncoderMm: 0,
        frontZMm: 1100,
        phase: 'EXITED',
        entrySimTimeMs: 200,
        exitSimTimeMs: 3700,
      },
      retired: undefined,
      result: undefined,
      aggregate: aggregate(950),
      observations: [
        obs({ simTimeMs: 900, decoded: false }),
        obs({ simTimeMs: 1000, decoded: true }),
      ],
      simEvents: BASE_EVENTS,
      pipelineEvents: BASE_PIPELINE,
    });

    expect(stages.map((s) => s.id)).toEqual(
      TIMELINE_STAGE_ORDER.map((s) => s.id),
    );
    const byId = Object.fromEntries(stages.map((s) => [s.id, s.simTimeMs]));
    expect(byId.SPAWNED).toBe(100);
    expect(byId.ENTERED).toBe(200);
    // The 800 ms capture did NOT include P-001 — first qualifying one wins.
    expect(byId.CAPTURED).toBe(900);
    expect(byId.DECODED).toBe(1000);
    expect(byId.AGGREGATED).toBe(950);
    expect(byId.FINALIZED).toBe(4000);
    expect(byId.ACK).toBe(4050);
  });

  it('leaves unreached stages null (fresh parcel)', () => {
    const stages = parcelTimelineStages({
      parcelId: 'P-001',
      parcel: {
        parcelId: 'P-001',
        spec: {
          widthMm: 100,
          heightMm: 100,
          lengthMm: 100,
          lateralOffsetMm: 0,
          yawDeg: 0,
          material: 'KRAFT',
          tape: false,
          labels: [],
        },
        spawnSimTimeMs: 100,
        spawnEncoderMm: 0,
        frontZMm: -100,
        phase: 'SPAWNED',
      },
      retired: undefined,
      result: undefined,
      aggregate: undefined,
      observations: [],
      simEvents: BASE_EVENTS.slice(0, 2),
      pipelineEvents: [],
    });
    const byId = Object.fromEntries(stages.map((s) => [s.id, s.simTimeMs]));
    expect(byId.SPAWNED).toBe(100);
    for (const id of ['ENTERED', 'CAPTURED', 'DECODED', 'AGGREGATED', 'FINALIZED', 'ACK']) {
      expect(byId[id]).toBeNull();
    }
  });

  it('falls back to retired state for spawned/entered after retirement', () => {
    const stages = parcelTimelineStages({
      parcelId: 'P-001',
      parcel: undefined, // retired — no longer in the live map
      retired: {
        parcelId: 'P-001',
        spec: {
          widthMm: 100,
          heightMm: 100,
          lengthMm: 100,
          lateralOffsetMm: 0,
          yawDeg: 0,
          material: 'KRAFT',
          tape: false,
          labels: [],
        },
        spawnSimTimeMs: 100,
        entrySimTimeMs: 200,
        exitSimTimeMs: 3700,
        sortSimTimeMs: 4950,
      },
      result: undefined,
      aggregate: aggregate(950),
      observations: [obs({ simTimeMs: 1000, decoded: true })],
      simEvents: BASE_EVENTS,
      pipelineEvents: BASE_PIPELINE,
    });
    const byId = Object.fromEntries(stages.map((s) => [s.id, s.simTimeMs]));
    expect(byId.SPAWNED).toBe(100);
    expect(byId.ENTERED).toBe(200);
    expect(byId.ACK).toBe(4050);
  });

  it('currentTimelineStage returns the last reached stage', () => {
    const stages = parcelTimelineStages({
      parcelId: 'P-001',
      parcel: undefined,
      retired: undefined,
      result: undefined,
      aggregate: aggregate(950),
      observations: [obs({ simTimeMs: 1000, decoded: true })],
      simEvents: BASE_EVENTS,
      pipelineEvents: [],
    });
    expect(currentTimelineStage(stages)?.id).toBe('AGGREGATED');
    expect(currentTimelineStage([])).toBeNull();
  });
});

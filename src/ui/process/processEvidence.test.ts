/**
 * processEvidence (t11): scripted SimEvent sequences → per-stage
 * pending/active/complete/failed + aggregate counts + final result.
 * Pure: same input twice → same output (AC-3 double-call).
 */

import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../domain/types';
import { PROCESS_GUIDE } from './processGuide';
import { processEvidence, type ObservationEvidence } from './processEvidence';

const P = 'P-0001';

const spawned = (simTimeMs: number): SimEvent => ({
  type: 'PARCEL_SPAWNED',
  parcelId: P,
  simTimeMs,
  encoderMm: simTimeMs * 2,
});
const entered = (simTimeMs: number): SimEvent => ({
  type: 'PARCEL_ENTERED',
  parcelId: P,
  simTimeMs,
  encoderMm: simTimeMs * 2,
});
const captured = (cameraId: string, simTimeMs: number, ids: string[] = [P]): SimEvent => ({
  type: 'CAMERA_CAPTURED',
  cameraId,
  simTimeMs,
  candidateParcelIds: ids,
});
const lineStarted = (simTimeMs: number): SimEvent => ({
  type: 'LINE_SCAN_STARTED',
  cameraId: 'CAM-005',
  parcelId: P,
  simTimeMs,
  encoderStartMm: 1300,
});
const lineCompleted = (simTimeMs: number): SimEvent => ({
  type: 'LINE_SCAN_COMPLETED',
  cameraId: 'CAM-005',
  parcelId: P,
  simTimeMs,
  encoderStartMm: 1300,
  encoderEndMm: 1800,
  lineCount: 5000,
  expectedLineCount: 5000,
  durationMs: 1900,
  complete: true,
});
const lineAborted = (simTimeMs: number, reason: 'CAMERA_FAULT' | 'CLOSE_SPACING' | 'MAX_STRIP'): SimEvent => ({
  type: 'LINE_SCAN_ABORTED',
  cameraId: 'CAM-005',
  parcelId: P,
  simTimeMs,
  encoderStartMm: 1300,
  encoderEndMm: 1450,
  lineCount: 1500,
  durationMs: 400,
  complete: false,
  reason,
});
const exited = (simTimeMs: number): SimEvent => ({
  type: 'PARCEL_EXITED',
  parcelId: P,
  simTimeMs,
  encoderMm: simTimeMs * 2,
});
const finalized = (simTimeMs: number, status: 'OK' | 'SENSOR_FAULT' | 'NO_READ'): SimEvent => ({
  type: 'PARCEL_FINALIZED',
  parcelId: P,
  simTimeMs,
  status,
});
const acked = (simTimeMs: number): SimEvent => ({
  type: 'PARCEL_ACKED',
  parcelId: P,
  simTimeMs,
});
const sorted = (simTimeMs: number): SimEvent => ({
  type: 'PARCEL_SORTED',
  parcelId: P,
  simTimeMs,
  encoderMm: simTimeMs * 2,
});

const obs = (over: Partial<ObservationEvidence>): ObservationEvidence => ({
  decoded: false,
  qualityPassed: false,
  reasons: [],
  ...over,
});

function stageOf(out: ReturnType<typeof processEvidence>, stageId: string) {
  return out.stages.find((s) => s.stageId === stageId);
}

describe('processEvidence (t11)', () => {
  it('fully decoded parcel: every stage complete, decode+association complete', () => {
    const events: SimEvent[] = [
      spawned(0),
      entered(500),
      captured('CAM-001', 1000),
      lineStarted(1100),
      lineCompleted(3000),
      exited(5000),
      finalized(5100, 'OK'),
      acked(5200),
      sorted(5300),
    ];
    const out = processEvidence({
      parcelId: P,
      events,
      observations: [obs({ decoded: true, qualityPassed: true }), obs({ qualityPassed: true })],
      result: { status: 'OK', expectedLabels: 2, decodedLabels: 2 },
    });

    // Guide order, all complete.
    expect(out.stages.map((s) => s.stageId)).toEqual(
      PROCESS_GUIDE.map((s) => s.id),
    );
    for (const s of out.stages) expect(s.status).toBe('complete');

    expect(stageOf(out, 'decode')?.count).toBe(1);
    expect(stageOf(out, 'association')?.count).toBe(1);
    expect(out.captureCount).toBe(2); // 1 area + 1 line session
    expect(out.decodedCount).toBe(1);
    expect(out.finalStatus).toBe('OK');
  });

  it('faulted strip: acquisition failed with the abort reason, upstream blocked stages pending', () => {
    const events: SimEvent[] = [
      spawned(0),
      entered(500),
      lineStarted(1100),
      lineAborted(1500, 'CAMERA_FAULT'),
      exited(5000),
      finalized(5100, 'SENSOR_FAULT'),
    ];
    const out = processEvidence({
      parcelId: P,
      events,
      observations: [obs({ qualityPassed: false, reasons: ['CAMERA_FAULT'] })],
      result: { status: 'SENSOR_FAULT', expectedLabels: 1, decodedLabels: 0 },
    });

    expect(stageOf(out, 'reader-triggering')?.status).toBe('complete');
    expect(stageOf(out, 'acquisition')?.status).toBe('failed');
    expect(stageOf(out, 'acquisition')?.detail).toBe('CAMERA_FAULT');
    expect(stageOf(out, 'quality-gating')?.status).toBe('failed');
    expect(stageOf(out, 'quality-gating')?.detail).toBe('CAMERA_FAULT');
    expect(stageOf(out, 'decode')?.status).toBe('pending');
    expect(stageOf(out, 'association')?.status).toBe('pending');
    expect(stageOf(out, 'exit-finalization')?.status).toBe('complete');
    expect(stageOf(out, 'exit-finalization')?.detail).toBe('SENSOR_FAULT');
    expect(stageOf(out, 'plc-ack-sort')?.status).toBe('pending');
    expect(out.finalStatus).toBe('SENSOR_FAULT');
  });

  it('in-flight parcel: open strip → acquisition active, aggregation pending', () => {
    const out = processEvidence({
      parcelId: P,
      events: [spawned(0), entered(500), lineStarted(1100)],
      observations: [],
    });
    expect(stageOf(out, 'created')?.status).toBe('complete');
    expect(stageOf(out, 'reader-triggering')?.status).toBe('complete');
    expect(stageOf(out, 'acquisition')?.status).toBe('active');
    expect(stageOf(out, 'preprocessing')?.status).toBe('complete');
    expect(stageOf(out, 'quality-gating')?.status).toBe('active');
    expect(stageOf(out, 'decode')?.status).toBe('pending');
    expect(stageOf(out, 'dedup-aggregation')?.status).toBe('pending');
    expect(stageOf(out, 'exit-finalization')?.status).toBe('pending');
    expect(out.captureCount).toBe(1);
  });

  it('a closed area capture makes acquisition complete even with an open strip', () => {
    const out = processEvidence({
      parcelId: P,
      events: [spawned(0), entered(500), captured('CAM-001', 1000), lineStarted(1100)],
      observations: [],
    });
    expect(stageOf(out, 'acquisition')?.status).toBe('complete');
    expect(stageOf(out, 'acquisition')?.count).toBe(1);
    expect(out.captureCount).toBe(2);
  });

  it('freshly spawned parcel: only created complete, entry active', () => {
    const out = processEvidence({
      parcelId: P,
      events: [spawned(0)],
      observations: [],
    });
    expect(stageOf(out, 'created')?.status).toBe('complete');
    expect(stageOf(out, 'entry-tracking')?.status).toBe('active');
    expect(stageOf(out, 'acquisition')?.status).toBe('pending');
    expect(out.captureCount).toBe(0);
  });

  it('ignores other parcels\' events', () => {
    const out = processEvidence({
      parcelId: P,
      events: [spawned(0), captured('CAM-001', 1000, ['P-OTHER'])],
      observations: [],
    });
    expect(stageOf(out, 'reader-triggering')?.status).toBe('pending');
    expect(out.captureCount).toBe(0);
  });

  it('is pure: same input twice → same output (double call)', () => {
    const input = {
      parcelId: P,
      events: [
        spawned(0),
        entered(500),
        captured('CAM-001', 1000),
        lineStarted(1100),
        lineAborted(1500, 'CLOSE_SPACING'),
        finalized(5100, 'NO_READ'),
      ] as SimEvent[],
      observations: [obs({ decoded: true, qualityPassed: true })],
      result: { status: 'NO_READ' as const, expectedLabels: 1, decodedLabels: 0 },
    };
    expect(processEvidence(input)).toEqual(processEvidence(input));
  });
});

/**
 * Domain event log utilities (events.ts).
 */

import {
  eventsForParcel,
  exitToAckMs,
  firstEventOfType,
  finalizeToAckMs,
  lastEventOfType,
} from './events';
import type { ParcelResult, SimEvent } from './types';

const LOG: SimEvent[] = [
  { type: 'RUN_RESET', simTimeMs: 0, seed: 2026 },
  { type: 'PARCEL_SPAWNED', parcelId: 'P-1', simTimeMs: 100, encoderMm: 0 },
  { type: 'PARCEL_ENTERED', parcelId: 'P-1', simTimeMs: 300, encoderMm: 200 },
  { type: 'CAMERA_CAPTURED', cameraId: 'CAM-001', simTimeMs: 400, candidateParcelIds: ['P-1'] },
  { type: 'PARCEL_EXITED', parcelId: 'P-1', simTimeMs: 900, encoderMm: 3000 },
  { type: 'PARCEL_SPAWNED', parcelId: 'P-2', simTimeMs: 1000, encoderMm: 3200 },
  { type: 'PARCEL_FINALIZED', parcelId: 'P-1', simTimeMs: 1150, status: 'OK' },
  { type: 'PARCEL_ACKED', parcelId: 'P-1', simTimeMs: 1200 },
];

function result(over: Partial<ParcelResult>): ParcelResult {
  return {
    parcelId: 'P-1',
    status: 'OK',
    expectedLabels: 1,
    decodedLabels: 1,
    uniquePayloads: 1,
    payloads: ['A'],
    labelResults: [],
    entrySimTimeMs: 300,
    exitSimTimeMs: 900,
    finalizedSimTimeMs: 1150,
    entryToResultMs: 850,
    exitToResultMs: 250,
    ...over,
  };
}

describe('eventsForParcel', () => {
  it('keeps only the parcel-scoped events, in log order', () => {
    const e = eventsForParcel(LOG, 'P-1');
    expect(e.map((x) => x.type)).toEqual([
      'PARCEL_SPAWNED',
      'PARCEL_ENTERED',
      'PARCEL_EXITED',
      'PARCEL_FINALIZED',
      'PARCEL_ACKED',
    ]);
  });

  it('empty for an unknown parcel', () => {
    expect(eventsForParcel(LOG, 'P-9')).toEqual([]);
  });
});

describe('first/lastEventOfType', () => {
  it('first returns the earliest, last the latest', () => {
    expect(firstEventOfType(LOG, 'PARCEL_SPAWNED')?.parcelId).toBe('P-1');
    expect(lastEventOfType(LOG, 'PARCEL_SPAWNED')?.parcelId).toBe('P-2');
  });

  it('undefined when the type is absent', () => {
    expect(firstEventOfType(LOG, 'PARCEL_SORTED')).toBeUndefined();
    expect(lastEventOfType(LOG, 'PARCEL_SORTED')).toBeUndefined();
  });
});

describe('ack latencies', () => {
  it('exitToAckMs is undefined until acked, then exit → ack', () => {
    expect(exitToAckMs(result({}))).toBeUndefined();
    expect(exitToAckMs(result({ ackSimTimeMs: 1200 }))).toBe(300);
  });

  it('finalizeToAckMs measures the PLC round trip', () => {
    expect(finalizeToAckMs(result({ ackSimTimeMs: 1200 }))).toBe(50);
  });
});

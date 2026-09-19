import {
  scheduleCaptures,
  visibleParcelIds,
} from './scheduler';
import { defaultCameraRigs, validateCameraRigs } from '../domain/camera';
import type { ParcelState } from '../domain/types';

const STATION = { lengthMm: 2200, beltWidthMm: 650 };
const CAMS = {
  sensorWidthPx: 5320,
  sensorHeightPx: 3032,
  focalLengthMm: 16,
  exposureUs: 75,
  fps: 20,
  shutter: 'GLOBAL' as const,
};
const rigs = () => defaultCameraRigs(STATION, CAMS);

function makeParcel(
  parcelId: string,
  frontZMm: number,
  lateralOffsetMm = 0,
): ParcelState {
  return {
    parcelId,
    spec: {
      widthMm: 220,
      heightMm: 160,
      lengthMm: 300,
      lateralOffsetMm,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm,
    phase: 'ENTERED',
  };
}

const FRONT = () => rigs()[0];

describe('visibleParcelIds (CAM-005 trigger zone)', () => {
  it('sees a parcel inside the zone and not one beyond the sensor', () => {
    const rig = FRONT();
    const inZone = makeParcel('P1', 600);
    const beyond = makeParcel('P2', 4000); // far enough to leave the sensor
    expect(visibleParcelIds(rig, [inZone, beyond])).toEqual(['P1']);
  });

  it('sees nothing with an empty belt', () => {
    expect(visibleParcelIds(FRONT(), [])).toEqual([]);
  });
});

describe('scheduleCaptures (CAM-005, CAM-004)', () => {
  it('arms and captures on zone entry, then cycles CAPTURING→PROCESSING→IDLE', () => {
    const rs = rigs();
    const parcel = makeParcel('P1', 600);
    let out = scheduleCaptures({
      rigs: rs,
      states: { 'CAM-001': 'IDLE' },
      parcels: [parcel],
      simTimeMs: 0,
      lastCaptureMs: {},
    });
    // IDLE → ARMED → CAPTURING in one step (armed + due captures immediately).
    expect(out.states['CAM-001']).toBe('CAPTURING');
    expect(out.captures).toHaveLength(1);
    expect(out.captures[0]).toMatchObject({
      cameraId: 'CAM-001',
      simTimeMs: 0,
      candidateParcelIds: ['P1'],
    });

    out = scheduleCaptures({
      rigs: rs,
      states: out.states,
      parcels: [parcel],
      simTimeMs: 10,
      lastCaptureMs: out.lastCaptureMs,
    });
    expect(out.states['CAM-001']).toBe('PROCESSING');
    expect(out.captures).toEqual([]);

    out = scheduleCaptures({
      rigs: rs,
      states: out.states,
      parcels: [parcel],
      simTimeMs: 20,
      lastCaptureMs: out.lastCaptureMs,
    });
    expect(out.states['CAM-001']).toBe('IDLE');

    out = scheduleCaptures({
      rigs: rs,
      states: out.states,
      parcels: [parcel],
      simTimeMs: 30,
      lastCaptureMs: out.lastCaptureMs,
    });
    // Re-armed, but only 30 ms since the last capture (< 50 ms @ 20 fps).
    expect(out.states['CAM-001']).toBe('ARMED');
    expect(out.captures).toEqual([]);
  });

  it('drains to IDLE when the zone empties and re-captures when it refills', () => {
    const rs = rigs();
    let out = scheduleCaptures({
      rigs: rs,
      states: { 'CAM-001': 'IDLE' },
      parcels: [makeParcel('P1', 600)],
      simTimeMs: 0,
      lastCaptureMs: {},
    });
    expect(out.states['CAM-001']).toBe('CAPTURING');
    // Parcel leaves the zone mid-pipeline; the in-flight steps drain first.
    out = scheduleCaptures({
      rigs: rs,
      states: out.states,
      parcels: [makeParcel('P1', 4000)], // left the zone
      simTimeMs: 10,
      lastCaptureMs: out.lastCaptureMs,
    });
    expect(out.states['CAM-001']).toBe('PROCESSING');
    out = scheduleCaptures({
      rigs: rs,
      states: out.states,
      parcels: [makeParcel('P1', 4000)],
      simTimeMs: 20,
      lastCaptureMs: out.lastCaptureMs,
    });
    expect(out.states['CAM-001']).toBe('IDLE');
    out = scheduleCaptures({
      rigs: rs,
      states: out.states,
      parcels: [makeParcel('P2', 600)], // refilled, but 30 ms < 50 ms
      simTimeMs: 30,
      lastCaptureMs: out.lastCaptureMs,
    });
    expect(out.states['CAM-001']).toBe('ARMED');
    expect(out.captures).toEqual([]);
    out = scheduleCaptures({
      rigs: rs,
      states: out.states,
      parcels: [makeParcel('P2', 600)],
      simTimeMs: 50,
      lastCaptureMs: out.lastCaptureMs,
    });
    expect(out.states['CAM-001']).toBe('CAPTURING');
    expect(out.captures).toHaveLength(1);
  });

  it('respects the acquisition fps between captures (CAM-005)', () => {
    const rs = rigs();
    const parcel = makeParcel('P1', 600);
    // ARMED at t=0, capture at t=10 (fps 20 -> 50 ms interval).
    let out = scheduleCaptures({
      rigs: rs,
      states: { 'CAM-001': 'ARMED' },
      parcels: [parcel],
      simTimeMs: 0,
      lastCaptureMs: {},
    });
    expect(out.captures).toHaveLength(1);
    // Cycle CAPTURING->PROCESSING->IDLE->ARMED, each 10 ms later:
    // at t=40 the camera is ARMED again but only 30 ms since capture.
    out = scheduleCaptures({
      rigs: rs, states: out.states, parcels: [parcel], simTimeMs: 10,
      lastCaptureMs: out.lastCaptureMs,
    });
    out = scheduleCaptures({
      rigs: rs, states: out.states, parcels: [parcel], simTimeMs: 20,
      lastCaptureMs: out.lastCaptureMs,
    });
    out = scheduleCaptures({
      rigs: rs, states: out.states, parcels: [parcel], simTimeMs: 30,
      lastCaptureMs: out.lastCaptureMs,
    });
    out = scheduleCaptures({
      rigs: rs, states: out.states, parcels: [parcel], simTimeMs: 40,
      lastCaptureMs: out.lastCaptureMs,
    });
    expect(out.states['CAM-001']).toBe('ARMED');
    expect(out.captures).toHaveLength(0); // 30 ms < 50 ms — not due yet
    out = scheduleCaptures({
      rigs: rs, states: out.states, parcels: [parcel], simTimeMs: 50,
      lastCaptureMs: out.lastCaptureMs,
    });
    expect(out.captures).toHaveLength(1); // 50 ms — due
  });

  it('never captures from FAULT or OFFLINE (CAM-009)', () => {
    const rs = rigs();
    const parcel = makeParcel('P1', 600);
    for (const state of ['FAULT', 'OFFLINE'] as const) {
      const out = scheduleCaptures({
        rigs: rs,
        states: { 'CAM-001': state },
        parcels: [parcel],
        simTimeMs: 0,
        lastCaptureMs: {},
      });
      expect(out.captures).toEqual([]);
      expect(out.states['CAM-001']).toBe(state);
    }
  });

  it('skips disabled rigs entirely', () => {
    const rs = rigs();
    rs[0] = { ...rs[0], enabled: false };
    const out = scheduleCaptures({
      rigs: rs,
      states: { 'CAM-001': 'IDLE' },
      parcels: [makeParcel('P1', 600)],
      simTimeMs: 0,
      lastCaptureMs: {},
    });
    expect(out.states['CAM-001']).toBe('IDLE');
    expect(out.captures).toEqual([]);
  });

  it('lists every parcel in the zone in candidateParcelIds', () => {
    const rs = rigs();
    const out = scheduleCaptures({
      rigs: rs,
      states: { 'CAM-005': 'ARMED', 'CAM-001': 'IDLE' },
      parcels: [makeParcel('P1', 600), makeParcel('P2', 1200)],
      simTimeMs: 0,
      lastCaptureMs: {},
    });
    const top = out.captures.find((c) => c.cameraId === 'CAM-005');
    expect(top?.candidateParcelIds).toContain('P1');
    expect(top?.candidateParcelIds).toContain('P2');
  });

  it('keeps the default rigs valid for the scheduler to consume', () => {
    expect(validateCameraRigs(rigs())).toEqual([]);
  });

  it('accepts one-shot iterables (Map.values) — every rig sees every parcel', () => {
    // Production call shape: sim.ts passes `s.parcels.values()`, a single
    // iterator that would drain after the first rig if iterated per-rig.
    const rs = rigs();
    // Production dims (400×400×600): at station centre all six rigs see it.
    const parcel = makeParcel('P1', 1400);
    parcel.spec = { ...parcel.spec, widthMm: 400, heightMm: 400, lengthMm: 600 };
    const map = new Map<string, ParcelState>();
    map.set('P1', parcel);
    const out = scheduleCaptures({
      rigs: rs,
      states: Object.fromEntries(rs.map((r) => [r.id, 'IDLE' as const])),
      parcels: map.values(),
      simTimeMs: 0,
      lastCaptureMs: {},
    });
    const captured = new Set(out.captures.map((c) => c.cameraId));
    for (const rig of rs) {
      expect(captured.has(rig.id)).toBe(true);
      expect(out.captures.find((c) => c.cameraId === rig.id)?.candidateParcelIds).toEqual(['P1']);
    }
  });
});

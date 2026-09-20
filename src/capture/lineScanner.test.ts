/**
 * LineScanSession + LINE_SCAN_* events + fixed-step sim integration (t4).
 *
 * Asserts the bounded event contract: one STARTED plus one
 * COMPLETED/ABORTED per parcel-rig pass, line counts from the t3 formula,
 * fault aborts, the close-spacing policy (no interleaved lines), and
 * run-level determinism (NFR-006).
 */

import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from '../domain/config';
import { defaultLineScanRig } from '../domain/camera';
import type { SimEvent } from '../domain/types';
import { Simulation } from '../simulation/sim';

const LINE_ID = 'LS-001';
const PLANE_Z = 1100; // station centre (station 2200)

type Started = Extract<SimEvent, { type: 'LINE_SCAN_STARTED' }>;
type Completed = Extract<SimEvent, { type: 'LINE_SCAN_COMPLETED' }>;
type Aborted = Extract<SimEvent, { type: 'LINE_SCAN_ABORTED' }>;

function lineScanConfig(mutate?: (cfg: SimConfig) => void): SimConfig {
  const cfg = defaultConfig();
  cfg.cameraRigs = [defaultLineScanRig(LINE_ID, 'TOP', [0, 900, PLANE_Z], [0, 1, 0, 0], PLANE_Z)];
  cfg.parcel.lengthMm = 500; // -> 5000 lines at 0.1 mm/line
  cfg.parcel.tapeChance = 0;
  if (mutate) mutate(cfg);
  return cfg;
}

function isLineScanEvent(e: SimEvent): e is Started | Completed | Aborted {
  return e.type.startsWith('LINE_SCAN_');
}

function lineScanEvents(sim: Simulation): (Started | Completed | Aborted)[] {
  return sim.state.events.filter(isLineScanEvent);
}

function firstStarted(evs: SimEvent[]): Started {
  const e = evs.find((x) => x.type === 'LINE_SCAN_STARTED');
  if (!e || e.type !== 'LINE_SCAN_STARTED') throw new Error('expected LINE_SCAN_STARTED');
  return e;
}

describe('line-scan session events (t4)', () => {
  it('a parcel crossing the plane emits exactly STARTED then COMPLETED, no per-line events', () => {
    const sim = new Simulation(lineScanConfig());
    sim.start();
    // P1 spawns at 2000 ms; its front crosses the plane at 3600 ms, rear at 4100 ms.
    sim.stepMany(900);

    const evs = lineScanEvents(sim);
    expect(evs.map((e) => e.type)).toEqual(['LINE_SCAN_STARTED', 'LINE_SCAN_COMPLETED']);

    const started = firstStarted(evs);
    const completed = evs[1]!;
    if (completed.type !== 'LINE_SCAN_COMPLETED') throw new Error('expected COMPLETED');
    expect(completed.lineCount).toBe(5000); // 500 mm at 0.1 mm/line (t3 formula)
    expect(completed.expectedLineCount).toBe(5000);
    expect(completed.complete).toBe(true);
    // The strip spans exactly one parcel length of encoder travel.
    expect(completed.encoderEndMm - completed.encoderStartMm).toBeCloseTo(500, 3);
    expect(completed.parcelId).toBe(started.parcelId);
    expect(completed.cameraId).toBe(LINE_ID);
    // Bounded stream: no per-line events ever.
    expect(evs.length).toBe(2);
  });

  it('a mid-scan camera fault yields ABORTED (complete=false) and closes the session', () => {
    const sim = new Simulation(lineScanConfig());
    sim.start();
    // Run until the strip is open.
    while (
      lineScanEvents(sim).every((e) => e.type !== 'LINE_SCAN_STARTED') &&
      sim.state.simTimeMs < 20000
    ) {
      sim.step();
    }
    const started = firstStarted(lineScanEvents(sim));

    // Fault the scanner mid-strip.
    sim.state.cameraStates[LINE_ID] = 'FAULT';
    sim.stepMany(400);

    const evs = lineScanEvents(sim);
    expect(evs.map((e) => e.type)).toEqual(['LINE_SCAN_STARTED', 'LINE_SCAN_ABORTED']);
    const aborted = evs[1]!;
    if (aborted.type !== 'LINE_SCAN_ABORTED') throw new Error('expected ABORTED');
    expect(aborted.complete).toBe(false);
    expect(aborted.reason).toBe('CAMERA_FAULT');
    expect(aborted.parcelId).toBe(started.parcelId);
    // The session is closed: no further line-scan events for this parcel.
    const after = lineScanEvents(sim).filter(
      (e) => e.type !== 'LINE_SCAN_ABORTED' && e.parcelId === started.parcelId,
    );
    expect(after.map((e) => e.type)).toEqual(['LINE_SCAN_STARTED']);
  });

  it('close spacing: the first session is ABORTED (CLOSE_SPACING), the second completes — no interleaving', () => {
    const sim = new Simulation(lineScanConfig((cfg) => {
      cfg.parcel.spawnIntervalMs = 100000; // manual spawn control below
    }));
    sim.state.nextSpawnMs = 100; // P1 at 100 ms
    sim.start();
    sim.stepMany(30); // P1 spawned (front will cross the plane at 1700 ms)
    // P2 300 ms later (300 mm gap < 500 mm parcel); the scheduler then
    // pushes nextSpawnMs out by the 100 s interval, so no third parcel.
    sim.state.nextSpawnMs = sim.state.simTimeMs + 300;
    sim.stepMany(600); // P2's rear clears the plane at 2550 ms

    const evs = lineScanEvents(sim);
    const byParcel = new Map<string, string[]>();
    for (const e of evs) {
      byParcel.set(e.parcelId, [...(byParcel.get(e.parcelId) ?? []), e.type]);
    }
    const [first, second] = [...byParcel.entries()];
    // First parcel: STARTED then ABORTED (its rear had not cleared the
    // plane when the second parcel's front arrived).
    expect(first?.[1]).toEqual(['LINE_SCAN_STARTED', 'LINE_SCAN_ABORTED']);
    const firstAborted = evs.find((e) => e.type === 'LINE_SCAN_ABORTED' && e.parcelId === first?.[0]);
    if (!firstAborted || firstAborted.type !== 'LINE_SCAN_ABORTED') throw new Error('no abort');
    expect(firstAborted.reason).toBe('CLOSE_SPACING');
    expect(firstAborted.complete).toBe(false);
    // Second parcel: a clean, complete strip.
    expect(second?.[1]).toEqual(['LINE_SCAN_STARTED', 'LINE_SCAN_COMPLETED']);
    const secondCompleted = evs.find(
      (e) => e.type === 'LINE_SCAN_COMPLETED' && e.parcelId === second?.[0],
    );
    if (!secondCompleted || secondCompleted.type !== 'LINE_SCAN_COMPLETED')
      throw new Error('no completed');
    expect(secondCompleted.lineCount).toBe(5000);
  });

  it('determinism: identical seed/config produce identical LINE_SCAN event streams', () => {
    const run = () => {
      const sim = new Simulation(
        lineScanConfig((cfg) => {
          cfg.cameraRigs.push(
            defaultLineScanRig('LS-002', 'BOTTOM', [0, -900, PLANE_Z], [0, -1, 0, 0], PLANE_Z),
          );
          cfg.parcel.spawnIntervalMs = 1200;
        }),
      );
      sim.start();
      sim.stepMany(1200);
      return sim.state.events
        .filter(isLineScanEvent)
        .map((e) => ({
          type: e.type,
          simTimeMs: e.simTimeMs,
          cameraId: e.cameraId,
          parcelId: e.parcelId,
          lineCount: 'lineCount' in e ? e.lineCount : undefined,
        }));
    };
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});

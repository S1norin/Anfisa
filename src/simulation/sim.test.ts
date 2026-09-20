import { defaultConfig, type SimConfig } from '../domain/config';
import type { SimEvent } from '../domain/types';
import { Simulation } from './sim';
import { FIXED_STEP_MS } from './state';

function eventsOf(sim: Simulation): SimEvent[] {
  return sim.state.events;
}

function ofType<T extends SimEvent['type']>(ev: SimEvent[], type: T) {
  return ev.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** Snapshot of domain state relevant to NFR-006 (no wall-clock fields). */
function snapshot(sim: Simulation) {
  return JSON.stringify({
    events: eventsOf(sim),
    encoderMm: sim.state.encoderMm,
    parcels: [...sim.state.parcels.values()].map((p) => ({
      id: p.parcelId,
      frontZMm: p.frontZMm,
      phase: p.phase,
    })),
    finalized: sim.state.finalized.map((f) => f.parcelId),
  });
}

describe('fixed-step simulation', () => {
  it('spawns parcels at the configured front-to-front interval', () => {
    const sim = new Simulation(defaultConfig());
    sim.start();
    sim.stepMany(1000 / FIXED_STEP_MS); // 1 s
    const spawns = eventsOf(sim).filter((e) => e.type === 'PARCEL_SPAWNED');
    // t=0 is not a spawn; spawns at 2000 ms multiples. After 1 s: none yet.
    expect(spawns).toEqual([]);
    sim.stepMany(2000 / FIXED_STEP_MS); // -> t=3 s
    const spawns2 = eventsOf(sim).filter((e) => e.type === 'PARCEL_SPAWNED');
    expect(spawns2.map((e) => e.simTimeMs)).toEqual([2000]);
  });

  it('emits entry/exit/sort events at the right encoder positions', () => {
    const sim = new Simulation(defaultConfig());
    sim.start();
    // Run until the first parcel is sorted: spawn@2000ms, enters@2600ms
    // (0.6 m at 1 m/s), exits@2600+2200=4800ms, sort@4800+1250=6050ms.
    sim.stepMany(8000 / FIXED_STEP_MS);
    const ev = eventsOf(sim);
    const first = ofType(ev, 'PARCEL_SPAWNED')[0]!;
    const entry = ofType(ev, 'PARCEL_ENTERED').find((e) => e.parcelId === first.parcelId)!;
    const exit = ofType(ev, 'PARCEL_EXITED').find((e) => e.parcelId === first.parcelId)!;
    const sort = ofType(ev, 'PARCEL_SORTED').find((e) => e.parcelId === first.parcelId)!;
    expect(entry.simTimeMs).toBe(2600);
    expect(exit.simTimeMs).toBe(4800);
    expect(sort.simTimeMs).toBe(6050);
    expect(entry.encoderMm).toBeCloseTo(2600, 5);
    expect(exit.encoderMm).toBeCloseTo(4800, 5);
    expect(sort.encoderMm).toBeCloseTo(6050, 5);
    // Retired once fully past the sort point.
    expect(sim.state.finalized.map((f) => f.parcelId)).toContain(first.parcelId);
    expect(sim.state.parcels.has(first.parcelId)).toBe(false);
  });

  it('is deterministic: identical snapshots under two step schedules (NFR-006)', () => {
    const cfg = defaultConfig();
    const a = new Simulation(cfg);
    const b = new Simulation(cfg);
    a.start();
    b.start();
    const total = 10_000 / FIXED_STEP_MS;
    // Schedule A: one step at a time.
    for (let i = 0; i < total; i++) a.step();
    // Schedule B: chunked (simulates a different display refresh rate).
    b.stepMany(total);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('speed change mid-run keeps encoder continuity and parcel association (SIM-004)', () => {
    const cfg = defaultConfig();
    const sim = new Simulation(cfg);
    sim.start();
    sim.stepMany(3000 / FIXED_STEP_MS);
    const before = sim.state.encoderMm;
    const parcel = [...sim.state.parcels.values()][0];
    const zBefore = parcel.frontZMm;
    sim.setSpeed(1500);
    sim.stepMany(1000 / FIXED_STEP_MS);
    // Encoder advanced by exactly 1500 mm (1500 mm/s * 1 s).
    expect(sim.state.encoderMm - before).toBeCloseTo(1500, 5);
    // Parcel follows the encoder delta exactly.
    expect(parcel.frontZMm - zBefore).toBeCloseTo(1500, 5);
    // Speed change is recorded in the event log.
    const changes = sim.state.events.filter((e) => e.type === 'SPEED_CHANGED');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ fromMmPerSec: 1000, toMmPerSec: 1500 });
    // Clamp to the configured max.
    sim.setSpeed(9999);
    expect(sim.state.speedMmPerSec).toBe(1500);
  });

  it('spawns correctly for non step-aligned intervals', () => {
    const cfg = defaultConfig();
    cfg.parcel.spawnIntervalMs = 1337;
    const sim = new Simulation(cfg);
    sim.start();
    sim.stepMany(6000 / FIXED_STEP_MS);
    const spawns = sim.state.events.filter((e) => e.type === 'PARCEL_SPAWNED');
    // ~4-5 spawns expected (1337, 2674, 4011, 5348); none at 6000.
    expect(spawns.length).toBeGreaterThanOrEqual(4);
    expect(spawns.length).toBeLessThanOrEqual(5);
    const times = spawns.map((e) => e.simTimeMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('run/pause/reset (SIM-003)', () => {
    const cfg = defaultConfig();
    const sim = new Simulation(cfg);
    expect(sim.state.status).toBe('IDLE');
    sim.start();
    expect(sim.state.status).toBe('RUNNING');
    sim.stepMany(1000 / FIXED_STEP_MS);
    sim.pause();
    const frozen = snapshot(sim);
    sim.stepMany(1000 / FIXED_STEP_MS); // paused: pump() must not advance
    sim.pump(1000);
    expect(snapshot(sim)).toBe(frozen);
    sim.reset();
    expect(sim.state.simTimeMs).toBe(0);
    expect(sim.state.encoderMm).toBe(0);
    expect(sim.state.parcels.size).toBe(0);
    expect(sim.state.events.map((e) => e.type)).toEqual(['RUN_RESET']);
  });

  it('stepOnce advances exactly one fixed step while paused (issue #13)', () => {
    const sim = new Simulation(defaultConfig());
    sim.start();
    sim.stepMany(400); // let a parcel spawn (default interval 2000ms)
    expect(sim.state.parcels.size).toBeGreaterThan(0);
    expect(sim.stepOnce()).toBe(false); // RUNNING: no-op
    sim.pause();
    const before = sim.state.simTimeMs;
    const parcelBefore = [...sim.state.parcels.values()][0].frontZMm;

    expect(sim.stepOnce()).toBe(true);
    expect(sim.state.status).toBe('PAUSED');
    expect(sim.state.simTimeMs).toBe(before + FIXED_STEP_MS);
    const parcelAfter = [...sim.state.parcels.values()][0].frontZMm;
    const dEncoder = (sim.state.speedMmPerSec * FIXED_STEP_MS) / 1000;
    expect(parcelAfter).toBeCloseTo(parcelBefore + dEncoder, 6);

    // Stepping paused steps is deterministic: same trajectory as continuous run.
    const stepped = new Simulation(defaultConfig());
    stepped.start();
    stepped.stepMany(401);
    expect(stepped.state.simTimeMs).toBe(sim.state.simTimeMs);
    expect(stepped.state.encoderMm).toBe(sim.state.encoderMm);
  });

  it('same seed + config reproduces identical runs (NFR-006, AC-08 core)', () => {
    const run = (mutate: (c: SimConfig) => void) => {
      const cfg = defaultConfig();
      mutate(cfg);
      const sim = new Simulation(cfg);
      sim.start();
      sim.stepMany(12_000 / FIXED_STEP_MS);
      return snapshot(sim);
    };
    expect(run(() => undefined)).toBe(run(() => undefined));
    const mutated = (c: SimConfig) => {
      c.belt.speedMmPerSec = 800;
    };
    expect(run(mutated)).toBe(run(mutated));
    expect(run(mutated)).not.toBe(run(() => undefined));
  });
});

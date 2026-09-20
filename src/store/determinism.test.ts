/**
 * AC-08 determinism (t16-2): identical config + seed repeated at
 * DIFFERENT display refresh rates produces byte-for-byte equivalent
 * domain records (no wall-clock UI timestamps exist in the record —
 * every time is sim time).
 *
 * This is the regression test for the per-step finalize/ACK replay in
 * SimStore.tick: before the fix, finalize/ACK fired at tick-end
 * granularity, so a 100 ms tick run finalized up to 100 ms later than
 * a 16 ms tick run.
 *
 * All rates are driven for the SAME number of domain steps (taken from
 * a headless reference run) so the only variable is tick chunking.
 */

import { describe, expect, it } from 'vitest';
import { recommendedSixViewConfig } from '../capture/presets';
import { ProcessRun } from '../pipeline/runDriver';
import { buildLiveRunRecord } from '../export/json';
import { FIXED_STEP_MS } from '../simulation/state';
import { SimStore } from './simStore';

const PARCELS = 20;

function baselineCfg(): ReturnType<typeof recommendedSixViewConfig> {
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

/** The exact number of domain steps to a full completion. */
function referenceSteps(): number {
  const ref = new ProcessRun(baselineCfg(), PARCELS);
  ref.runToCompletion();
  return Math.round(ref.record().simTimeMs / FIXED_STEP_MS);
}

/**
 * Drive a live store for exactly `steps` domain steps, mirroring the
 * headless driver's spawn cap. `tickMs` selects the simulated display
 * refresh rate (speed factor 1: real ms == sim ms).
 */
function runForSteps(
  steps: number,
  tickMs: number,
): ReturnType<typeof buildLiveRunRecord> {
  const store = new SimStore(baselineCfg());
  store.sim.start();
  let executed = 0;
  while (executed < steps) {
    // Exact step count per tick (floor(tickMs/5) at speed factor 1),
    // truncated on the final tick so the total lands exactly on `steps`.
    const stepsPerTick = Math.min(
      Math.floor(tickMs / FIXED_STEP_MS),
      steps - executed,
    );
    store.tick(stepsPerTick * FIXED_STEP_MS);
    executed += stepsPerTick;
    if (store.parcelsSpawned >= PARCELS) {
      store.sim.state.nextSpawnMs = Infinity;
    }
  }
  return buildLiveRunRecord(store, store.computeLiveMetrics());
}

describe('AC-08: refresh-rate independence', () => {
  const steps = referenceSteps();
  const record60 = runForSteps(steps, 16.7); // ~60 Hz display
  const record10 = runForSteps(steps, 100); // ~10 Hz display
  const recordStep = runForSteps(steps, 5); // 1 domain step per tick

  it('60 Hz and 10 Hz runs are byte-for-byte identical records', () => {
    expect(JSON.stringify(record60)).toBe(JSON.stringify(record10));
  });

  it('step-granular ticking matches the coarser tickings too', () => {
    expect(JSON.stringify(recordStep)).toBe(JSON.stringify(record60));
  });

  it('matches the headless reference run exactly', () => {
    const ref = new ProcessRun(baselineCfg(), PARCELS);
    ref.runToCompletion();
    const refRecord = ref.record();
    expect(JSON.stringify(record60.results)).toBe(
      JSON.stringify(refRecord.results),
    );
    expect(JSON.stringify(record60.observations)).toBe(
      JSON.stringify(refRecord.observations),
    );
    expect(JSON.stringify(record60.metrics)).toBe(
      JSON.stringify(refRecord.metrics),
    );
  });

  it('the records are complete runs (20 finalized parcels)', () => {
    expect(record60.results).toHaveLength(PARCELS);
    expect(record60.metrics.evaluatedParcels).toBe(PARCELS);
    expect(record60.observations.length).toBeGreaterThan(0);
  });
});

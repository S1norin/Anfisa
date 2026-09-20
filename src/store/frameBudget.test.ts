/**
 * NFR-001 frame budget, CPU side (t16-1).
 *
 * The display pump runs `SimStore.tick` once per animation frame. At the
 * 60 Hz target that is a 16.7 ms frame budget, shared with WebGL rendering
 * and React. This test drives the live "10 parcels in flight" scenario at a
 * simulated 60 Hz (speed factor 1: real ms == sim ms) and asserts the
 * tick's wall-clock cost stays far inside the budget, leaving headroom for
 * the renderer.
 *
 * The full 55-60 FPS browser number is a visual check (README walkthrough)
 * because it needs a real GL context; this headless test guards the
 * pipeline/sim CPU work that would otherwise eat the frame.
 */

import { describe, expect, it } from 'vitest';
import { recommendedSixViewConfig } from '../capture/presets';
import { SimStore } from './simStore';

const ACTIVE_PARCELS = 10;
const TICK_MS = 16.7; // ~60 Hz display
const WINDOW_SIM_MS = 4000; // measure over 4 s of sim time

function baselineCfg(): ReturnType<typeof recommendedSixViewConfig> {
  const cfg = recommendedSixViewConfig();
  cfg.seed = 2026;
  cfg.belt.speedMmPerSec = 1000;
  cfg.parcel.spawnIntervalMs = 250; // pack 10 parcels in flight quickly
  cfg.parcel.labelCountMin = 1;
  cfg.parcel.labelCountMax = 4;
  cfg.parcel.material = 'KRAFT';
  cfg.parcel.tapeChance = 0;
  cfg.parcel.labelDamageChance = 0;
  return cfg;
}

/**
 * Fill the belt to ACTIVE_PARCELS in flight, freeze spawns, then tick at
 * 60 Hz for WINDOW_SIM_MS, timing every tick during the measurement window.
 */
function timedRun(): { avgMs: number; p99Ms: number; ticks: number } {
  const store = new SimStore(baselineCfg());
  store.sim.start();

  // Phase 1: fill to 10 active parcels (spawns every 250 ms of sim).
  while (store.sim.state.parcels.size < ACTIVE_PARCELS) {
    store.tick(TICK_MS);
  }
  store.sim.state.nextSpawnMs = Infinity;

  // Phase 2: timed measurement window.
  const tickMs: number[] = [];
  let windowMs = 0;
  while (windowMs < WINDOW_SIM_MS) {
    const t0 = performance.now();
    store.tick(TICK_MS);
    tickMs.push(performance.now() - t0);
    windowMs += TICK_MS;
  }

  tickMs.sort((a, b) => a - b);
  const avg = tickMs.reduce((a, b) => a + b) / Math.max(1, tickMs.length);
  const p99 = tickMs[Math.max(0, Math.floor(0.99 * tickMs.length) - 1)];
  return { avgMs: avg, p99Ms: p99, ticks: tickMs.length };
}

describe('NFR-001: frame budget (CPU side, 10 parcels in flight @ 60 Hz)', () => {
  it('fills the belt to 10 active parcels', () => {
    const store = new SimStore(baselineCfg());
    store.sim.start();
    while (store.sim.state.parcels.size < ACTIVE_PARCELS) store.tick(TICK_MS);
    expect(store.sim.state.parcels.size).toBeGreaterThanOrEqual(ACTIVE_PARCELS);
  });

  it('average tick cost is far inside the 16.7 ms frame budget', () => {
    const r = timedRun();
    expect(r.ticks).toBeGreaterThan(0);
    // Measured ~0.1-0.4 ms; allow < 2 ms average (8x headroom for render).
    expect(r.avgMs).toBeLessThan(2);
  });

  it('p99 tick cost stays well inside the frame budget', () => {
    const r = timedRun();
    // Measured p99 ~0.5-1.5 ms (one-off GC/JIT spikes aside); a real CPU
    // regression would raise the whole tail. 10 ms leaves margin for the
    // ~2 ms of browser render on the 16.7 ms frame.
    expect(r.p99Ms).toBeLessThan(10);
  });
});

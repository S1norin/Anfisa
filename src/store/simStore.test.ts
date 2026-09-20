/**
 * SimStore live pipeline (t11): the store feeds scheduled captures through
 * the same glue as ProcessRun, so a stepped live run must match the
 * headless driver parcel-for-parcel (NFR-006), and reset must wipe the
 * processing state.
 */

import { describe, it, expect, vi } from 'vitest';
import { defaultConfig } from '../domain/config';
import { recommendedSixViewConfig } from '../capture/presets';
import { SimStore } from './simStore';
import { ProcessRun } from '../pipeline/runDriver';

/** The recommended 6-view preset: the layout that reads (default rig
 *  geometry is a stress case — see baseline test). */
function readingCfg(): ReturnType<typeof recommendedSixViewConfig> {
  return recommendedSixViewConfig();
}

function storeRun(steps: number, store: SimStore): void {
  store.start();
  // Drive the display pump in small real-time slices so several domain
  // steps land per tick (the live path batches events per tick).
  for (let i = 0; i < steps; i += 10) {
    store.tick(Math.min(10, steps - i) * 5);
  }
}

describe('SimStore live pipeline', () => {
  it('decodes, finalizes, and acks parcels live', () => {
    const store = new SimStore(readingCfg());
    storeRun(4000, store); // 20 s at 200 Hz — several full parcel cycles

    expect(store.parcelsSpawned).toBeGreaterThan(0);
    expect(store.results.length).toBeGreaterThan(0);
    expect(store.liveObservations.length).toBeGreaterThan(0);
    expect(store.totalDecodedObservations).toBeGreaterThan(0);

    // Every finalized result eventually gets its simulated PLC ACK.
    for (const r of store.results) {
      expect(r.ackSimTimeMs).toBeDefined();
      expect(r.ackSimTimeMs! - r.exitSimTimeMs).toBeGreaterThanOrEqual(0);
    }

    // Timeline-relevant events exist for the first result.
    const first = store.results[0];
    const finalized = store.pipelineEvents.find(
      (e) => e.type === 'PARCEL_FINALIZED' && e.parcelId === first.parcelId,
    );
    const acked = store.pipelineEvents.find(
      (e) => e.type === 'PARCEL_ACKED' && e.parcelId === first.parcelId,
    );
    expect(finalized).toBeDefined();
    expect(acked).toBeDefined();

    // Live metrics are populated and consistent with the results.
    const m = store.computeLiveMetrics();
    expect(m.evaluatedParcels).toBe(store.results.length);
    expect(m.totalObservations).toBeGreaterThan(0);
    expect(m.barcodeRecall).toBeGreaterThan(0);
  });

  it('matches the headless driver result-for-result for the same steps', () => {
    const cfg = readingCfg();
    cfg.seed = 777;

    // Headless: exact per-step feeding (ProcessRun).
    const run = new ProcessRun(cfg);
    run.stepMany(2500);

    // Live: same config, pumped in chunks (≤ 7 steps = 17.5 mm belt
    // travel at the preset speed — inside the 50 mm association window).
    const store = new SimStore(cfg);
    store.start();
    for (let i = 0; i < 2500; i += 7) {
      store.tick(Math.min(7, 2500 - i) * 5);
    }

    expect(store.results.map((r) => r.parcelId)).toEqual(
      run.pipeline.results.map((r) => r.parcelId),
    );
    expect(store.results.map((r) => r.status)).toEqual(
      run.pipeline.results.map((r) => r.status),
    );
    expect(store.results.map((r) => r.payloads)).toEqual(
      run.pipeline.results.map((r) => r.payloads),
    );
    // Finalize/ACK sim times are quantized to the tick boundary on the
    // live path (≤ 35 ms drift for 7-step ticks), step-quantized headless:
    // same decisions, bounded time drift — the display-coupled invariant.
    const headless = run.pipeline.results.map((r) => ({
      fin: r.finalizedSimTimeMs!,
      ack: r.ackSimTimeMs,
    }));
    store.results.forEach((r, i) => {
      const h = headless[i]!;
      expect(Math.abs(r.finalizedSimTimeMs! - h.fin)).toBeLessThanOrEqual(35);
      // Ack times compare only when both paths have acked the parcel.
      // The live ack follows the (tick-drifted) finalize, so the chained
      // bound is two tick quanta (2 × 35 ms).
      if (r.ackSimTimeMs !== undefined && h.ack !== undefined) {
        expect(Math.abs(r.ackSimTimeMs - h.ack)).toBeLessThanOrEqual(70);
      }
    });
    expect(store.parcelsSpawned).toBe(run.spawnedCount);
  });

  it('reset clears results, observations, and counters', () => {
    const store = new SimStore(readingCfg());
    storeRun(2000, store);
    expect(store.results.length).toBeGreaterThan(0);
    expect(store.liveObservations.length).toBeGreaterThan(0);

    store.reset();

    expect(store.results).toHaveLength(0);
    expect(store.liveObservations).toHaveLength(0);
    expect(store.pipelineEvents).toHaveLength(0);
    expect(store.parcelsSpawned).toBe(0);
    expect(store.totalDecodedObservations).toBe(0);

    // The store keeps ticking after reset and repopulates.
    storeRun(1000, store);
    expect(store.liveObservations.length).toBeGreaterThan(0);
  });

  it('tick() notifies React only when the sim clock moves', () => {
    const store = new SimStore(defaultConfig());
    const listener = vi.fn();
    store.subscribe(listener);
    store.tick(50); // IDLE: pump is a no-op
    expect(listener).not.toHaveBeenCalled();
    store.start();
    store.tick(50);
    expect(listener).toHaveBeenCalled();
  });

  it('a faulted camera stops contributing decoded observations', () => {
    const cfg = readingCfg();
    const store = new SimStore(cfg);
    // CAM-003 is a decoder in the default seed (FRONT/BACK rigs decode
    // little-to-none — see baseline). Fault one that contributes.
    const camId = cfg.cameraRigs[2].id;

    storeRun(1500, store);
    const before = store.liveObservations.filter(
      (o) => o.cameraId === camId && o.decoded,
    ).length;
    expect(before).toBeGreaterThan(0);

    store.setCameraFault(camId, true);
    const obsBefore = store.liveObservations.length;
    storeRun(1000, store);
    const newDecoded = store.liveObservations
      .slice(obsBefore)
      .filter((o) => o.cameraId === camId && o.decoded);
    expect(newDecoded).toHaveLength(0);
  });
});

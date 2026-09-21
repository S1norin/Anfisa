/**
 * Deterministic end-to-end report scenarios (t6-scenarios): the full
 * pipeline (ProcessRun, bounded parcels) driven through the eight-reader
 * report layout for eight physically-motivated cases. Every scenario is
 * pinned to seed 42 / 8 parcels and asserts its documented, reproducible
 * outcome. Observations are checked to associate with the correct
 * parcel in every case (labelResults never reference a foreign instance,
 * and every decoded payload equals its instance's ground-truth payload).
 *
 * Documented outcomes (seed 42, 8 parcels, tape 0, damage 0 baseline):
 *   centred      → line faces 100% (6/6), 11/17 total, precision 1.0
 *   lateral 120  → identical to centred (offset inside the 125 mm guide range)
 *   yaw 15°      → 10/17 (a face normal rotates off the fixed reader ring)
 *   tape 1.0     → identical to centred (residual glare 0.2 < 0.6 gate; the
 *                  top-face specular lobe points down — no up-looking reader)
 *   damage 1.0   → 6/20, complete 0.125
 *   camera fault → one side reader down: 10/17 < centred 11/17 (reduced recall)
 *   close 600 ms → complete 0, 2/17, 16 cross-parcel mismatches (CLOSE_SPACING)
 *   speed 1.5 m/s→ 5/6 line obs fail LOW_PPM (15 000 lines/s > 12 000 ceiling)
 */

import { describe, expect, it } from 'vitest';
import { reportEightReaderConfig } from '../capture/presets';
import type { SimConfig } from '../domain/config';
import type { RunRecord } from '../metrics/runRecord';
import { ProcessRun } from '../pipeline/runDriver';

const SEED = 42;
const MAX_PARCELS = 8;

/** Clean baseline config (tape 0, damage 0) for the pinned seed. */
function base(): SimConfig {
  const cfg = reportEightReaderConfig();
  cfg.seed = SEED;
  cfg.parcel.tapeChance = 0;
  cfg.parcel.labelDamageChance = 0;
  return cfg;
}

function runTo(cfg: SimConfig): RunRecord {
  const run = new ProcessRun(cfg, MAX_PARCELS);
  run.runToCompletion();
  return run.record();
}

/**
 * AC-2: observations associate with the correct parcel. For every result,
 * every labelResult references an instance that is physically on that
 * parcel (structural), and every decoded payload equals the instance's
 * ground-truth payload (semantic).
 */
function assertAssociation(rec: RunRecord): { decoded: number } {
  let decoded = 0;
  for (const r of rec.results) {
    const spec = rec.groundTruth.find((g) => g.parcelId === r.parcelId)!.spec;
    const byInstance = new Map(spec.labels.map((l) => [l.labelInstanceId, l.payload]));
    expect(r.labelResults.length, `${r.parcelId} labelResults == spec labels`).toBe(spec.labels.length);
    for (const lr of r.labelResults) {
      expect(byInstance.has(lr.labelInstanceId), `${r.parcelId}:${lr.labelInstanceId} is on this parcel`).toBe(true);
      if (lr.decoded) {
        decoded++;
        expect(
          lr.decodedPayload,
          `${r.parcelId}:${lr.labelInstanceId} payload matches ground truth`,
        ).toBe(byInstance.get(lr.labelInstanceId));
      }
    }
  }
  return { decoded };
}

function lineObs(rec: RunRecord) {
  return rec.observations.filter((o) => o.acquisitionKind === 'LINE_SCAN');
}

describe('t6-scenarios: report eight-reader end-to-end (seed 42, 8 parcels)', () => {
  it('centred: line faces 100%, 11/17 total, precision 1.0', () => {
    const rec = runTo(base());
    assertAssociation(rec);
    const m = rec.metrics;
    expect(m.expectedInstances).toBe(17);
    expect(m.decodedInstances).toBe(11);
    expect(m.barcodeRecall).toBeCloseTo(11 / 17, 6);
    expect(m.completeReadRate).toBe(0.5);
    expect(m.barcodePrecision).toBe(1);
    expect(m.falseDecodes).toBe(0);
    expect(m.misassociations).toBe(0);
    // The two line scanners (TOP/BOTTOM) read every line face 100% at the
    // 1 m/s operating speed — no undersampling.
    const lines = lineObs(rec);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((o) => o.decoded)).toBe(true);
    expect(lines.some((o) => o.reasons.includes('LOW_PPM'))).toBe(false);
  });

  it('lateral offset 120 mm: inside the guide range → identical to centred', () => {
    const cfg = base();
    cfg.parcel.lateralOffsetMm = 120;
    const rec = runTo(cfg);
    assertAssociation(rec);
    const m = rec.metrics;
    // 120 mm < the 125 mm guide lateral range: both line planes and the
    // side FOVs still cover every label exactly as centred.
    expect(m.expectedInstances).toBe(17);
    expect(m.decodedInstances).toBe(11);
    expect(m.barcodeRecall).toBeCloseTo(11 / 17, 6);
    expect(lineObs(rec).every((o) => o.decoded)).toBe(true);
  });

  it('yaw 15°: a face normal rotates off the reader ring → 10/17', () => {
    const cfg = base();
    cfg.parcel.yawDeg = 15;
    const rec = runTo(cfg);
    assertAssociation(rec);
    const m = rec.metrics;
    expect(m.expectedInstances).toBe(17);
    expect(m.decodedInstances).toBe(10);
    expect(m.barcodeRecall).toBeCloseTo(10 / 17, 6);
    expect(m.barcodePrecision).toBe(1);
    expect(m.falseDecodes).toBe(0);
  });

  it('glare (tape 1.0): no GLARE gate trips in this layout → identical to centred', () => {
    const cfg = base();
    cfg.parcel.tapeChance = 1.0;
    const rec = runTo(cfg);
    assertAssociation(rec);
    const m = rec.metrics;
    // The polarised line/area lights suppress the mirror highlight to a
    // 0.2 residual (below the 0.6 GLARE gate), and the top-face specular
    // lobe reflects downward — no up-looking reader sees it. So glare is a
    // documented no-op for the eight-reader layout.
    expect(m.barcodeRecall).toBeCloseTo(11 / 17, 6);
    expect(m.barcodePrecision).toBe(1);
    const glare = rec.results
      .flatMap((r) => r.labelResults)
      .filter((lr) => lr.reasons.includes('GLARE')).length;
    expect(glare).toBe(0);
  });

  it('damaged label (1.0): print damage drops reads to 6/20', () => {
    const cfg = base();
    cfg.parcel.labelDamageChance = 1.0;
    const rec = runTo(cfg);
    assertAssociation(rec);
    const m = rec.metrics;
    expect(m.expectedInstances).toBe(20);
    expect(m.decodedInstances).toBe(6);
    expect(m.barcodeRecall).toBeCloseTo(0.3, 6);
    expect(m.completeReadRate).toBe(0.125);
    expect(m.barcodePrecision).toBe(1);
    expect(m.falseDecodes).toBe(0);
  });

  it('camera fault (one side reader): recall drops below the centred baseline', () => {
    const baseline = runTo(base());
    const baselineRecall = baseline.metrics.barcodeRecall;
    const baselineDecoded = baseline.metrics.decodedInstances;

    const cfg = base();
    const run = new ProcessRun(cfg, MAX_PARCELS);
    run.stepMany(1000); // 5 s in: the 30° FRONT reader goes down mid-run
    run.sim.state.cameraStates['CAM-001'] = 'FAULT';
    run.runToCompletion();
    const rec = run.record();
    assertAssociation(rec);

    const m = rec.metrics;
    // AC-3: reduced recall vs baseline, with no fabricated reads.
    expect(m.decodedInstances).toBeLessThan(baselineDecoded);
    expect(m.barcodeRecall).toBeLessThan(baselineRecall);
    expect(m.barcodeRecall).toBeCloseTo(10 / 17, 6);
    expect(m.barcodePrecision).toBe(1);
    expect(m.falseDecodes).toBe(0);
    // The fault never fabricates a read from the dead camera.
    expect(rec.observations.filter((o) => o.cameraId === 'CAM-001' && o.decoded)).toHaveLength(0);
  });

  it('close spacing (600 ms): CLOSE_SPACING aborts, cross-parcel mismatches are flagged', () => {
    const cfg = base();
    cfg.parcel.spawnIntervalMs = 600; // 600 mm front-to-front == parcel length
    const rec = runTo(cfg);
    // Structural association still holds even with touching parcels.
    assertAssociation(rec);
    const m = rec.metrics;
    // Parcels are essentially touching: sessions abort and reads collapse.
    expect(m.completeReadRate).toBe(0);
    expect(m.decodedInstances).toBe(2);
    expect(m.barcodeRecall).toBeCloseTo(2 / 17, 6);
    // The decoder flags (not silently accepts) payloads that belong to a
    // neighbouring parcel.
    expect(m.misassociations).toBe(16);
    expect(m.falseDecodes).toBe(0);
    // Every line-scan abort is the close-spacing policy decision.
    const aborts = rec.simEvents.filter(
      (e) => e.type === 'LINE_SCAN_ABORTED',
    );
    for (const e of aborts) {
      expect(e.reason).toBe('CLOSE_SPACING');
    }
  });

  it('speed change 1.0→1.5 m/s: line strips deterministically fail LOW_PPM', () => {
    const baseline = runTo(base());
    const cfg = base();
    const run = new ProcessRun(cfg, MAX_PARCELS);
    run.stepMany(1200); // 6 s at 1 m/s, then oversample → undersample
    run.sim.state.speedMmPerSec = 1500; // 15 000 lines/s > 12 000 ceiling
    run.runToCompletion();
    const rec = run.record();
    assertAssociation(rec);

    const m = rec.metrics;
    // AC-3: the baseline (1 m/s) decodes every line observation; after the
    // speed change the strips are complete but undersampled → LOW_PPM.
    expect(baseline.metrics.decodedInstances).toBeGreaterThan(m.decodedInstances);
    const lines = lineObs(rec);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((o) => o.decoded)).toHaveLength(1);
    expect(lines.filter((o) => o.reasons.includes('LOW_PPM'))).toHaveLength(5);
    // The strips themselves are complete — the sampling gate is what fails.
    expect(lines.every((o) => o.complete)).toBe(true);
    expect(m.barcodePrecision).toBe(1);
    expect(m.falseDecodes).toBe(0);
    expect(m.misassociations).toBe(0);
  });
});

/**
 * Baseline e2e (MET-008): the deliberately easy scenario from the plan —
 * seed 2026, 20 clean kraft parcels, 1–4 labels each, 1 m/s, recommended
 * 6-view preset. Asserts 100% synthetic complete read, a non-empty frame
 * buffer, exact parcel association, populated reason codes, and an
 * immutable, reproducible run record.
 */

import { describe, it, expect } from 'vitest';
import { recommendedSixViewConfig } from '../capture/presets';
import { ProcessRun } from '../pipeline/runDriver';
import { canonicalReasonOrder, REASON_ORDER } from '../observation/reasons';

const EXPECTED_PARCELS = 20;

function baselineRun(): ProcessRun {
  const cfg = recommendedSixViewConfig();
  cfg.seed = 2026;
  cfg.belt.speedMmPerSec = 1000;
  cfg.parcel.labelCountMin = 1;
  cfg.parcel.labelCountMax = 4;
  cfg.parcel.material = 'KRAFT';
  cfg.parcel.tapeChance = 0;
  cfg.parcel.labelDamageChance = 0;
  const run = new ProcessRun(cfg, EXPECTED_PARCELS);
  run.runToCompletion();
  return run;
}

describe('baseline run (seed 2026, 20 kraft parcels, 1 m/s, 6-view preset)', () => {
  it('achieves 100% synthetic complete read (MET-001/002/003)', () => {
    const run = baselineRun();
    const results = run.pipeline.results;
    expect(results).toHaveLength(EXPECTED_PARCELS);

    let expected = 0;
    for (const r of results) {
      expect(r.status).toBe('OK');
      expect(r.decodedLabels).toBe(r.expectedLabels);
      expect(r.payloads.length).toBe(r.expectedLabels);
      expect(r.ackSimTimeMs).toBeDefined();
      expected += r.expectedLabels;
    }
    const m = run.record().metrics;
    expect(m.evaluatedParcels).toBe(EXPECTED_PARCELS);
    expect(m.completeReadRate).toBe(1);
    expect(m.barcodeRecall).toBe(1);
    expect(m.barcodePrecision).toBe(1);
    expect(m.expectedInstances).toBe(expected);
    expect(m.correctDecodes).toBe(expected);
  });

  it('tracks zero false decodes and zero misassociations (MET-004)', () => {
    const run = baselineRun();
    const m = run.record().metrics;
    expect(m.falseDecodes).toBe(0);
    expect(m.misassociations).toBe(0);
    expect(run.totalMismatches).toBe(0);
  });

  it('keeps a non-empty frame buffer with collapsed observations (MET-005)', () => {
    const run = baselineRun();
    const record = run.record();
    expect(run.frames.length).toBeGreaterThan(0);
    expect(record.observations.length).toBeGreaterThan(0);
    const m = record.metrics;
    expect(m.totalObservations).toBeGreaterThan(m.uniqueObservedInstances);
    expect(m.observationsCollapsed).toBeGreaterThan(0);
    // Every (parcel, instance) observed at least twice: the belt moves the
    // parcel through ~12+ readable frames per label.
    for (const r of record.results) {
      for (const lr of r.labelResults) {
        expect(lr.observationCount).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('associates every observation to the correct parcel (REV-05)', () => {
    const record = baselineRun().record();
    const byId = new Map(record.groundTruth.map((p) => [p.parcelId, p]));
    expect(byId.size).toBe(EXPECTED_PARCELS);
    for (const o of record.observations) {
      const parcel = byId.get(o.parcelId);
      expect(parcel).toBeDefined();
      const label = parcel!.spec.labels.find((l) => l.labelInstanceId === o.labelInstanceId);
      expect(label).toBeDefined();
      expect(label!.face).toBe(o.face);
    }
    // Every expected instance appears in its parcel's result, decoded.
    for (const p of byId.values()) {
      const r = record.results.find((x) => x.parcelId === p.parcelId)!;
      const ids = new Set(r.labelResults.map((lr) => lr.labelInstanceId));
      for (const label of p.spec.labels) {
        expect(ids.has(label.labelInstanceId)).toBe(true);
        const lr = r.labelResults.find((x) => x.labelInstanceId === label.labelInstanceId)!;
        expect(lr.decoded).toBe(true);
        expect(lr.decodedPayload).toBe(label.payload);
      }
    }
  });

  it('populates reason codes from the canonical set (PIPE-005)', () => {
    const record = baselineRun().record();
    const known = new Set<string>(REASON_ORDER);
    let sawReasons = 0;
    for (const o of record.observations) {
      for (const reason of o.reasons) expect(known.has(reason)).toBe(true);
      expect(canonicalReasonOrder(o.reasons)).toEqual(o.reasons);
      if (o.reasons.length > 0) sawReasons += 1;
    }
    // Some observations in the run fall outside the readable window
    // (parcel entering/leaving the camera's sweet spot) and report reasons.
    expect(sawReasons).toBeGreaterThan(0);
  });

  it('emits latency percentiles for all four stages (MET-006)', () => {
    const run = baselineRun();
    const m = run.record().metrics;
    expect(m.latency.captureToDecodeMs.n).toBeGreaterThan(0);
    expect(m.latency.entryToResultMs.n).toBe(EXPECTED_PARCELS);
    expect(m.latency.exitToResultMs.n).toBe(EXPECTED_PARCELS);
    expect(m.latency.exitToAckMs.n).toBe(EXPECTED_PARCELS);
    expect(m.latency.exitToAckMs.p50).toBeGreaterThanOrEqual(250); // grace + ACK
  });

  it('produces a complete, immutable, reproducible run record (MET-008)', () => {
    const runA = baselineRun();
    const runB = baselineRun();
    const recordA = runA.record();
    const recordB = runB.record();

    expect(Object.isFrozen(recordA)).toBe(true);
    expect(recordA.version).toBe(1);
    expect(recordA.seed).toBe(2026);
    expect(recordA.groundTruth).toHaveLength(EXPECTED_PARCELS);
    expect(recordA.frames.length).toBeGreaterThan(0);
    expect(recordA.observations.length).toBeGreaterThan(0);
    expect(recordA.results).toHaveLength(EXPECTED_PARCELS);
    expect(recordA.simEvents.length).toBeGreaterThan(0);
    expect(recordA.pipelineEvents.length).toBeGreaterThan(0);

    // Determinism (CFG-004 preview): identical config + seed → identical run.
    expect(JSON.stringify(recordA.metrics)).toBe(JSON.stringify(recordB.metrics));
    expect(JSON.stringify(recordA.results)).toBe(JSON.stringify(recordB.results));
    expect(JSON.stringify(recordA.observations)).toBe(JSON.stringify(recordB.observations));

    // JSON round-trip preserves the audit trail.
    const saved = JSON.parse(JSON.stringify(recordA));
    expect(saved.metrics.completeReadRate).toBe(1);
    expect(saved.results[0].status).toBe('OK');
    expect(saved.observations[0].cameraId).toBe(recordA.observations[0].cameraId);
  });
});

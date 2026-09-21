/**
 * t1-1: replay manifest schema + deterministic fixture tests.
 *
 * Covers the four task ACs: type coverage (fields present), determinism
 * (byte-identical JSON across builds), fixture content (pixel-decoded reads
 * / explicit no-read reasons, no fabricated values), and structural
 * invariants (captureId/parcelId/candidate.source references).
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildNoReadManifest, buildSuccessManifest } from './fixtures';
import {
  REPLAY_SCHEMA_VERSION,
  type ReplayManifest,
} from './replayManifest';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Structural invariants shared by both fixtures (AC 4). */
function assertInvariants(m: ReplayManifest): void {
  // Top-level shape (AC 1, runtime half of the type coverage check).
  expect(m.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
  expect(m.parcel.parcelId).toBeTypeOf('string');
  expect(m.parcel.parcelId.length).toBeGreaterThan(0);
  expect(m.durationMs).toBeGreaterThan(0);
  expect(m.keyframes.length).toBeGreaterThanOrEqual(2);
  expect(m.sensors.length).toBeGreaterThan(0);
  expect(m.captures.length).toBeGreaterThan(0);
  expect(m.observations.length).toBeGreaterThan(0);
  expect(m.steps).toHaveLength(8);
  expect(m.result.parcelId).toBe(m.parcel.parcelId);

  // Keyframes monotonic.
  for (let i = 1; i < m.keyframes.length; i++) {
    expect(m.keyframes[i].tMs).toBeGreaterThan(m.keyframes[i - 1].tMs);
  }

  // Steps tile the whole story.
  for (const s of m.steps) {
    expect(s.tEndMs).toBeGreaterThan(s.tStartMs);
    expect(s.sensorIds.every((id) => m.sensors.some((x) => x.id === id))).toBe(true);
    if (s.captureId) {
      expect(m.captures.some((c) => c.captureId === s.captureId)).toBe(true);
    }
  }
  expect(m.steps[0].tStartMs).toBe(0);
  expect(m.steps[m.steps.length - 1].tEndMs).toBe(m.durationMs);

  const captureIds = new Set(m.captures.map((c) => c.captureId));
  expect(captureIds.size).toBe(m.captures.length);
  const sensorIds = new Set(m.sensors.map((s) => s.id));
  const labelIds = new Set(m.parcel.labels.map((l) => l.labelInstanceId));

  for (const c of m.captures) {
    // Every capture references a real sensor and the manifest's parcel.
    expect(sensorIds.has(c.sensorId)).toBe(true);
    expect(c.parcelId).toBe(m.parcel.parcelId);
    expect(c.stages.length).toBeGreaterThan(0);
    expect(c.stages[0].stage).toBe('raw');
    for (const s of c.stages) {
      expect(s.path).toMatch(new RegExp(`^hiw/assets/${m.fixtureId}/${c.captureId}/.+\\.png$`));
    }
    if (c.candidate) {
      expect(['pixels', 'geometry', 'manual']).toContain(c.candidate.source);
      expect(labelIds.has(c.candidate.labelInstanceId)).toBe(true);
      expect(c.candidate.quadPx).toHaveLength(4);
    }
    if (c.expectedDecode) {
      if (c.expectedDecode.decoded) {
        expect(c.expectedDecode.payload).toBeTypeOf('string');
        expect(c.expectedDecode.reasons).toHaveLength(0);
        expect(c.decodeCropPath).toBeDefined();
      } else {
        expect(c.expectedDecode.payload).toBeUndefined();
        expect(c.expectedDecode.reasons.length).toBeGreaterThan(0);
      }
    }
  }

  for (const o of m.observations) {
    expect(captureIds.has(o.captureId)).toBe(true);
    expect(o.parcelId).toBe(m.parcel.parcelId);
    expect(labelIds.has(o.labelInstanceId)).toBe(true);
    if (o.decoded) {
      expect(o.decodedPayload).toBeTypeOf('string');
      expect(o.reasons).toHaveLength(0);
    } else {
      expect(o.decodedPayload).toBeUndefined();
      expect(o.reasons.length).toBeGreaterThan(0);
    }
  }

  // Final values are exactly the accepted, decoded observations' payloads.
  const accepted = m.observations.filter((o) => o.association.ok && o.decoded);
  const acceptedPayloads = new Set(accepted.map((o) => o.decodedPayload));
  for (const v of m.result.values) {
    expect(acceptedPayloads.has(v.payload)).toBe(true);
    expect(v.sourceCaptureIds.length).toBeGreaterThan(0);
    expect(v.mergedReads).toBe(v.sourceCaptureIds.length);
    for (const cid of v.sourceCaptureIds) {
      expect(
        m.observations.some(
          (o) =>
            o.captureId === cid &&
            o.association.ok &&
            o.decoded &&
            o.labelInstanceId === v.labelInstanceId,
        ),
      ).toBe(true);
    }
  }
  // Failed reads are exactly the rejected/failed observations.
  const failed = m.observations.filter((o) => !o.decoded);
  expect(m.result.failedReads).toHaveLength(failed.length);
  for (const f of m.result.failedReads) {
    expect(captureIds.has(f.captureId)).toBe(true);
  }
}

describe('replay manifest fixtures (t1-1)', () => {
  it('success fixture: pixel-decoded reads from line scan AND side camera', () => {
    const m = buildSuccessManifest();
    const line = m.captures.find((c) => c.kind === 'LINE_SCAN');
    const area = m.captures.find((c) => c.kind === 'AREA_CAMERA');
    expect(line?.expectedDecode?.decoded).toBe(true);
    expect(line?.expectedDecode?.payload).toBeTypeOf('string');
    expect(area?.expectedDecode?.decoded).toBe(true);
    expect(area?.expectedDecode?.payload).toBeTypeOf('string');
    // The dedup story: two side-camera reads of the SAME physical label.
    const side = m.result.values.find((v) => v.mergedReads === 2);
    expect(side).toBeDefined();
    // The honest-candidate story: at least one pixels-source candidate.
    expect(m.captures.some((c) => c.candidate?.source === 'pixels')).toBe(true);
  });

  it('no-read fixture: explicit no-read reasons, zero fabricated values', () => {
    const m = buildNoReadManifest();
    const failed = m.captures.filter((c) => c.expectedDecode && !c.expectedDecode.decoded);
    expect(failed.length).toBeGreaterThanOrEqual(1);
    for (const c of failed) {
      expect(c.expectedDecode?.payload).toBeUndefined();
      expect(c.expectedDecode?.reasons.length).toBeGreaterThan(0);
      const obs = m.observations.find((o) => o.captureId === c.captureId);
      expect(obs?.decoded).toBe(false);
      expect(obs?.decodedPayload).toBeUndefined();
    }
    // A geometry-derived candidate exercises the "illustrative" label.
    expect(m.captures.some((c) => c.candidate?.source === 'geometry')).toBe(true);
    // The failed label instance has no result value.
    const failedLabels = new Set(
      m.observations.filter((o) => !o.decoded).map((o) => o.labelInstanceId),
    );
    for (const v of m.result.values) {
      expect(failedLabels.has(v.labelInstanceId)).toBe(false);
    }
    expect(m.result.status).toBe('PARTIAL');
  });

  it('fixtures are deterministic: byte-identical JSON across builds', () => {
    for (const build of [buildSuccessManifest, buildNoReadManifest]) {
      const a = sha256(JSON.stringify(build()));
      const b = sha256(JSON.stringify(build()));
      expect(a).toBe(b);
    }
    // And the two fixtures are distinct.
    expect(sha256(JSON.stringify(buildSuccessManifest()))).not.toBe(
      sha256(JSON.stringify(buildNoReadManifest())),
    );
  });

  it('structural invariants hold on both fixtures', () => {
    assertInvariants(buildSuccessManifest());
    assertInvariants(buildNoReadManifest());
  });
});

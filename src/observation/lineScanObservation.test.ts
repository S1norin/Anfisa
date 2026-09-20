/**
 * Line-scan strip observation (t5).
 *
 * AC coverage:
 *  1. complete unoccluded TOP strip → decodable, effectivePpm from t3.
 *  2. BOTTOM strip over solid deck → null (no observation, no decode).
 *  3. aborted/incomplete strip → hard gate INCOMPLETE-family, no decode.
 *  4. under-sampled strip (belt 1.5 m/s, 12 k line cap) → LOW_PPM, fail.
 *  5. quality reuses evaluateQuality: shared-model gates (OUT_OF_FOV via
 *     coverageMin) appear in the line observation — no duplicated
 *     thresholds.
 */

import { describe, expect, it } from 'vitest';
import { defaultConfig, GAP_OPENING_MM } from '../domain/config';
import { defaultLineScanRig } from '../domain/camera';
import type { ParcelSpec, ParcelState } from '../domain/types';
import { observeLineScanStrip, type LineScanStripStatus } from './lineScanObservation';
import { stationDeckOccludesBottomStrip } from './occlusion';

const BELT_MM_S = 1000;

function makeParcel(id: string, overrides: Partial<ParcelSpec> = {}): ParcelState {
  return {
    parcelId: id,
    spec: {
      widthMm: 300,
      heightMm: 200,
      lengthMm: 500,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [],
      ...overrides,
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm: 1350,
    phase: 'ENTERED',
  };
}

function completeStrip(): LineScanStripStatus {
  return {
    encoderStartMm: 900,
    encoderEndMm: 1400, // 500 mm travel
    lineCount: 5000, // 0.1 mm/line
    expectedLineCount: 5000,
    complete: true,
  };
}

function observe(
  overrides: Partial<Parameters<typeof observeLineScanStrip>[0]> = {},
) {
  const cfg = defaultConfig();
  const rig = defaultLineScanRig('LS-001', 'TOP', [0, 900, 1100], [0, 1, 0, 0], 1100);
  return observeLineScanStrip({
    rig,
    parcel: makeParcel('P-0001'),
    strip: completeStrip(),
    simTimeMs: 4100,
    beltSpeedMmPerSec: BELT_MM_S,
    deckOccluded: false,
    cameraFault: false,
    thresholds: cfg.quality,
    seed: 2026,
    ...overrides,
  });
}

describe('line-scan strip observation (t5)', () => {
  it('complete unoccluded TOP strip → decodable, effectivePpm from the t3 formula', () => {
    const obs = observe()!;
    expect(obs).not.toBeNull();
    expect(obs.cameraId).toBe('LS-001');
    expect(obs.face).toBe('TOP');
    expect(obs.complete).toBe(true);
    // Cross-belt: 8192 px / 512 mm = 16 ppm; travel: 1 / 0.1 = 10 ppm.
    // Effective (bottleneck) = 10.
    expect(obs.effectivePpm).toBeCloseTo(10, 6);
    expect(obs.requiredLineRate).toBeCloseTo(10000, 6); // 1000 / 0.1
    expect(obs.quality.passed).toBe(true);
    expect(obs.decodable).toBe(true);
    expect(obs.quality.gateFailures).toEqual([]);
  });

  it('BOTTOM strip entirely over solid deck → no observation at all', () => {
    const cfg = defaultConfig();
    const rig = defaultLineScanRig('LS-002', 'BOTTOM', [0, -900, 1100], [0, -1, 0, 0], 1100);

    // SIDE_GRIP default: parcel fully outside the transfer zone [0, 2200].
    const outside = makeParcel('P-0002', { lengthMm: 400 });
    outside.frontZMm = -100;
    expect(stationDeckOccludesBottomStrip(cfg, outside)).toBe(true);
    expect(
      observe({
        rig,
        parcel: outside,
        deckOccluded: stationDeckOccludesBottomStrip(cfg, outside),
      }),
    ).toBeNull();

    // GAP mode: parcel fully clear of the centred 100 mm opening
    // (gap is [1050, 1150] for a 2200 mm station).
    cfg.station.bottomTransfer = 'GAP';
    const clearOfGap = makeParcel('P-0003');
    clearOfGap.frontZMm = 1800; // rear 1300 > 1150
    expect(clearOfGap.frontZMm - 500).toBeGreaterThan(
      cfg.station.lengthMm / 2 + GAP_OPENING_MM / 2,
    );
    expect(stationDeckOccludesBottomStrip(cfg, clearOfGap)).toBe(true);

    // Same parcel STRADDLING the gap → partially observable.
    const straddling = makeParcel('P-0004');
    straddling.frontZMm = 1350; // rear 850 < 1050 < front 1350
    expect(stationDeckOccludesBottomStrip(cfg, straddling)).toBe(false);
    const obs = observe({
      rig,
      parcel: straddling,
      deckOccluded: stationDeckOccludesBottomStrip(cfg, straddling),
    });
    expect(obs).not.toBeNull();
    expect(obs?.face).toBe('BOTTOM');
  });

  it('aborted/incomplete strip → INCOMPLETE-family hard gate, not decodable (shared gates co-exist)', () => {
    const obs = observe({
      strip: {
        ...completeStrip(),
        lineCount: 2500,
        complete: false,
        abortReason: 'CLOSE_SPACING',
      },
    })!;
    expect(obs.complete).toBe(false);
    expect(obs.abortReason).toBe('CLOSE_SPACING');
    expect(obs.quality.passed).toBe(false);
    expect(obs.decodable).toBe(false);
    // Shared-model gate from the quality thresholds (coverage 0.5 < 0.92
    // coverageMin) AND the line-specific INCOMPLETE gate.
    expect(obs.quality.gateFailures).toContain('OUT_OF_FOV');
    expect(obs.quality.gateFailures).toContain('INCOMPLETE_STRIP');
  });

  it('under-sampled strip (1.5 m/s, 12 k line cap) → LOW_PPM quality failure', () => {
    const obs = observe({ beltSpeedMmPerSec: 1500 })!;
    expect(obs.requiredLineRate).toBeCloseTo(15000, 6); // > 12000 cap
    expect(obs.quality.gateFailures).toContain('LOW_PPM');
    expect(obs.reasons).toContain('LOW_PPM');
    expect(obs.quality.passed).toBe(false);
    expect(obs.decodable).toBe(false);
  });

  it('camera fault at closure → CAMERA_FAULT gate, not decodable', () => {
    const obs = observe({ cameraFault: true })!;
    expect(obs.quality.gateFailures).toContain('CAMERA_FAULT');
    expect(obs.decodable).toBe(false);
  });

  it('deterministic: identical inputs → identical observations', () => {
    expect(observe()).toEqual(observe());
  });
});

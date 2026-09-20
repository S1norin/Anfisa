/**
 * feedCaptureEvent (t11): the shared glue between capture events and the
 * pipeline — used by BOTH the headless driver and the live store, so this
 * is where their identical behavior is pinned.
 */

import { describe, it, expect } from 'vitest';
import { defaultCameraRigs, lookAtQuaternion, toCameraSpace } from '../domain/camera';
import { defaultConfig } from '../domain/config';
import type { SimConfig } from '../domain/config';
import type { AreaScanCameraConfig, LabelInstance, ParcelState } from '../domain/types';
import { ParcelPipeline } from './pipeline';
import { feedCaptureEvent as feedCapture } from './feedCapture';

const STATION = { lengthMm: 2200, beltWidthMm: 650 };
const DEFAULTS = {
  sensorWidthPx: 5320,
  sensorHeightPx: 3032,
  focalLengthMm: 16,
  exposureUs: 75,
  fps: 20,
  shutter: 'GLOBAL' as const,
};

function leftRig(): AreaScanCameraConfig {
  const rig = defaultCameraRigs(STATION, DEFAULTS).find((r) => r.role === 'LEFT')!;
  const eye: [number, number, number] = [-1200, 700, 1100];
  const target: [number, number, number] = [0, 400, 1100];
  const pose = { positionMm: eye, quaternion: lookAtQuaternion(eye, target) };
  const z = toCameraSpace([-200, 400, 800], { ...rig, pose })[2];
  return { ...rig, pose, acquisition: { ...rig.acquisition, focusDistanceMm: z } };
}

function makeParcel(over: Partial<ParcelState> = {}): ParcelState {
  return {
    parcelId: 'P-001',
    spec: {
      widthMm: 400,
      heightMm: 400,
      lengthMm: 600,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: false,
      labels: [],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: 0,
    frontZMm: 1100,
    phase: 'ENTERED',
    ...over,
  };
}

function label(id: string, payload: string): LabelInstance {
  return {
    labelInstanceId: id,
    payload,
    face: 'LEFT',
    localOffsetMm: [0, 200],
    rotationDeg: 0,
    widthMm: 78,
    heightMm: 25,
    damage: 0,
  };
}

function makeCfg(): SimConfig {
  const cfg = defaultConfig();
  cfg.cameraRigs = [leftRig()];
  cfg.barcode.xDimensionMm = 1.1;
  return cfg;
}

describe('feedCaptureEvent', () => {
  it('runs engine → decode → associate and records one decoded observation', () => {
    const cfg = makeCfg();
    const parcel = makeParcel({
      entrySimTimeMs: 800,
      spec: { ...makeParcel().spec, labels: [label('L-0001', 'KTY-12345678901234')] },
    });
    const parcels = new Map([[parcel.parcelId, parcel]]);
    const pipeline = new ParcelPipeline();

    const out = {
      cameraId: cfg.cameraRigs[0].id,
      simTimeMs: 1000,
      encoderMm: 2000,
      candidateParcelIds: ['P-001'],
      config: cfg,
      parcels,
      cameraState: 'CAPTURING' as const,
      speedMmPerSec: 1000,
    };
    const res = feedCapture(out, pipeline);

    expect(res.observations).toHaveLength(1);
    const o = res.observations[0];
    expect(o.cameraId).toBe(out.cameraId);
    expect(o.simTimeMs).toBe(1000);
    expect(o.frameId).toBe(`${out.cameraId}@1000`);
    expect(o.parcelId).toBe('P-001');
    expect(o.labelInstanceId).toBe('L-0001');
    expect(o.decoded).toBe(true);
    expect(o.material).toBe('KRAFT');
    expect(res.stats.observations).toBe(1);
    expect(res.stats.decoded).toBe(1);
    expect(res.stats.mismatches).toBe(0);

    // Aggregation: one attributed, decoded instance on the parcel.
    const agg = pipeline.aggregateFor('P-001')!;
    expect(agg.labels).toHaveLength(1);
    expect(agg.labels[0].decoded).toBe(true);
    expect(agg.labels[0].cameras).toEqual([out.cameraId]);
  });

  it('returns empty stats for a capture by a removed camera', () => {
    const cfg = makeCfg();
    const parcels = new Map<string, ParcelState>();
    const pipeline = new ParcelPipeline();
    const res = feedCapture(
      {
        cameraId: 'CAM-GONE',
        simTimeMs: 100,
        encoderMm: 200,
        candidateParcelIds: [],
        config: cfg,
        parcels,
        cameraState: 'IDLE',
        speedMmPerSec: 1000,
      },
      pipeline,
    );
    expect(res.observations).toEqual([]);
    expect(res.stats).toEqual({
      frameId: 'CAM-GONE@100',
      observations: 0,
      decoded: 0,
      mismatches: 0,
    });
  });

  it('is deterministic: the same feed twice into fresh pipelines matches', () => {
    const cfg = makeCfg();
    const parcel = makeParcel({
      spec: { ...makeParcel().spec, labels: [label('L-0001', 'KTY-1')] },
    });
    const parcels = new Map([[parcel.parcelId, parcel]]);
    const input = {
      cameraId: cfg.cameraRigs[0].id,
      simTimeMs: 1000,
      encoderMm: 2000,
      candidateParcelIds: ['P-001'],
      config: cfg,
      parcels,
      cameraState: 'CAPTURING' as const,
      speedMmPerSec: 1000,
    };
    const a = feedCapture(input, new ParcelPipeline());
    const b = feedCapture(input, new ParcelPipeline());
    expect(a).toEqual(b);
  });
});

/**
 * Live Processing module tests (t7-3, sub-tasks s1+s2).
 *
 *  - AC1: camera selector offers top/bottom line scan + all six side
 *    cameras; selected camera + parcel ID are prominent;
 *  - AC2: all six tiles share the captureId + encoder span of the
 *    selected camera's newest result;
 *  - AC3: pause freezes all tiles together; resume follows the newest;
 *  - AC4: switching cameras changes raw + all derived stages together;
 *    AREA_FRAME vs LINE_STRIP identified; lag + dropped frames shown;
 *  - AC5: with the service unavailable the screen says 'Live Processing
 *    unavailable' (Guided Replay's mode toggle stays above the module).
 *
 * All tests run against a fake service — no network, no Python.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type {
  LiveCaptureInput,
  LiveProcessingResult,
  LiveProcessingService,
  LiveStageImage,
} from '../../../live-processing/contracts';
import { LiveView } from './liveView';
import type { LiveCropDecode } from './liveDecode';
import { LiveThrottleError } from '../../../live-processing/httpService';

const STAGE_NAMES = [
  'maskedCrop',
  'grayscaleContrast',
  'edgeMap',
  'candidateOverlay',
  'decodeCrop',
] as const;

function validResult(c: LiveCaptureInput): LiveProcessingResult {
  const stages: LiveStageImage[] = STAGE_NAMES.map((name) => ({
    name,
    data: new Uint8Array([1, 2, 3]),
    mime: 'image/png',
    width: 4,
    height: 4,
  }));
  return {
    captureId: c.captureId,
    seq: c.seq ?? 0,
    cameraId: c.cameraId,
    sourceType: c.sourceType,
    simTimeMs: c.simTimeMs,
    encoderSpanMm: [...c.encoderSpanMm],
    stages,
    candidate: { quadPx: [[1, 2], [3, 2], [3, 4], [1, 4]] as [number, number][], source: 'pixels' },
    decode: { decoded: false, pending: true, reasons: [], confidence: 0 },
    processingMs: 11,
  };
}

/** Resolves every request immediately. */
class ImmediateService implements LiveProcessingService {
  calls: LiveCaptureInput[] = [];
  process(c: LiveCaptureInput): Promise<LiveProcessingResult> {
    this.calls.push(c);
    return Promise.resolve(validResult(c));
  }
}

/** Manual settle — for dropped-frame accounting. */
class ManualService implements LiveProcessingService {
  calls: LiveCaptureInput[] = [];
  private flights: Array<{ c: LiveCaptureInput; resolve: (r: LiveProcessingResult) => void }> = [];
  process(c: LiveCaptureInput): Promise<LiveProcessingResult> {
    this.calls.push(c);
    return new Promise((resolve) => this.flights.push({ c, resolve: (r) => resolve(r) }));
  }
  get inFlight(): number {
    return this.flights.length;
  }
  settleOldest(): void {
    const f = this.flights.shift();
    if (f) f.resolve(validResult(f.c));
  }
}

const stubEncode = () =>
  Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]));
const okDecode = () =>
  Promise.resolve({ decoded: true, payload: 'ANFISA-LIVE-1', reasons: [] } as LiveCropDecode);

/**
 * Flush the fake-timer microtask queue fully (each act round flushes one
 * microtask generation + React renders) so the whole encode → service →
 * apply → decode chain settles.
 */
/** Advance fake timers inside act() so React state updates commit. */
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const flush = async () => {
  for (let i = 0; i < 8; i++) await tick(0);
};

describe('LiveView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC1: selector offers all 8 cameras; parcel ID + selected camera prominent', async () => {
    const svc = new ImmediateService();
    render(
      <LiveView
        service={svc}
        parcelId="PKG-123"
        labelPayload="ANFISA-LIVE-1"
        captureIntervalMs={50}
        encodeFrame={stubEncode}
        decodeCropStage={okDecode}
      />,
    );
    for (const id of [
      'ls-top',
      'ls-bottom',
      'cam-side-1',
      'cam-side-2',
      'cam-side-3',
      'cam-side-4',
      'cam-side-5',
      'cam-side-6',
    ]) {
      expect(screen.getByTestId(`live-cam-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('live-parcel-chip')).toHaveTextContent('PKG-123');
    expect(screen.getByTestId('live-selected-camera')).toHaveTextContent('side cam 1');
    expect(screen.getByTestId('live-cam-cam-side-1')).toHaveAttribute('aria-pressed', 'true');
    // First capture is sent; the service answer clears the banner.
    await flush();
    expect(svc.calls.length).toBe(1);
    expect(screen.queryByTestId('live-unavailable')).toBeNull();
  });

  it('AC2: all six tiles share the newest captureId + encoder span', async () => {
    const svc = new ImmediateService();
    render(
      <LiveView
        service={svc}
        parcelId="PKG-123"
        labelPayload="ANFISA-LIVE-1"
        captureIntervalMs={50}
        encodeFrame={stubEncode}
        decodeCropStage={okDecode}
      />,
    );
    await tick(110); // emits at t=0, 50, 100
    await flush();
    const newest = svc.calls[svc.calls.length - 1];
    const expected = `${newest.captureId} · encoder ${newest.encoderSpanMm[0]}–${newest.encoderSpanMm[1]} mm`;
    for (const key of [
      'raw',
      'maskedCrop',
      'grayscaleContrast',
      'edgeMap',
      'candidateOverlay',
      'decode',
    ]) {
      expect(screen.getByTestId(`live-tile-${key}-meta`)).toHaveTextContent(expected);
    }
  });

  it('AC3: pause freezes all tiles; resume follows the newest', async () => {
    const svc = new ImmediateService();
    render(
      <LiveView
        service={svc}
        parcelId="PKG-123"
        labelPayload="ANFISA-LIVE-1"
        captureIntervalMs={50}
        encodeFrame={stubEncode}
        decodeCropStage={okDecode}
      />,
    );
    await tick(100);
    const callsBefore = svc.calls.length;

    fireEvent.click(screen.getByTestId('live-pause'));
    await tick(50);
    await flush(); // a result already in flight may still arrive, then freeze
    const metaAtFreeze = screen.getByTestId('live-tile-raw-meta').textContent;
    const callsAtFreeze = svc.calls.length;

    await tick(200);
    await flush();
    expect(svc.calls.length).toBe(callsAtFreeze); // no new frames while paused
    expect(screen.getByTestId('live-tile-raw-meta').textContent).toBe(metaAtFreeze);

    fireEvent.click(screen.getByTestId('live-pause')); // resume
    await tick(60);
    expect(svc.calls.length).toBeGreaterThan(callsBefore);
  });

  it('AC4: camera switch updates raw + derived stages together; source type + lag/dropped shown', async () => {
    const svc = new ImmediateService();
    render(
      <LiveView
        service={svc}
        parcelId="PKG-123"
        labelPayload="ANFISA-LIVE-1"
        captureIntervalMs={50}
        encodeFrame={stubEncode}
        decodeCropStage={okDecode}
      />,
    );
    await tick(60);
    expect(screen.getByTestId('live-source-type')).toHaveTextContent('AREA_FRAME');

    fireEvent.click(screen.getByTestId('live-cam-ls-top'));
    await tick(10);
    await flush();
    const lsCap = svc.calls.filter((c) => c.cameraId === 'ls-top').at(-1);
    expect(lsCap).toBeTruthy();
    expect(screen.getByTestId('live-source-type')).toHaveTextContent('LINE_STRIP');
    const expected = `${lsCap!.captureId} · encoder ${lsCap!.encoderSpanMm[0]}–${lsCap!.encoderSpanMm[1]} mm`;
    for (const key of ['raw', 'maskedCrop', 'grayscaleContrast', 'edgeMap', 'candidateOverlay', 'decode']) {
      expect(screen.getByTestId(`live-tile-${key}-meta`)).toHaveTextContent(expected);
    }
    expect(screen.getByTestId('live-lag')).toBeTruthy();
    expect(screen.getByTestId('live-dropped')).toBeTruthy();
  });

  it('AC4b: dropped preview frames are counted when emits outpace results', async () => {
    const svc = new ManualService();
    render(
      <LiveView
        service={svc}
        parcelId="PKG-123"
        labelPayload="ANFISA-LIVE-1"
        captureIntervalMs={40}
        encodeFrame={stubEncode}
        decodeCropStage={okDecode}
      />,
    );
    await tick(200); // ~6 emits, none answered yet
    expect(svc.inFlight).toBeGreaterThan(0);
    svc.settleOldest();
    await flush();
    // emitted - applied - 2 (one in flight, one queued) > 0
    expect(Number(screen.getByTestId('live-dropped').getAttribute('data-dropped'))).toBeGreaterThan(0);
    expect(screen.getByTestId('live-lag')).toHaveTextContent(/in flight|service/);
  });

  it('AC5: service down -> "Live Processing unavailable", no request spam', async () => {
    let calls = 0;
    const down: LiveProcessingService = {
      process: () => {
        calls++;
        return Promise.reject(new Error('ECONNREFUSED'));
      },
    };
    render(
      <LiveView
        service={down}
        parcelId="PKG-123"
        captureIntervalMs={40}
        encodeFrame={stubEncode}
        decodeCropStage={okDecode}
      />,
    );
    const banner = screen.getByTestId('live-unavailable');
    expect(banner).toHaveTextContent('Live Processing unavailable');
    await flush(); // first emit fails -> unavailable
    const afterFirst = calls;
    expect(afterFirst).toBe(1);
    await tick(200);
    expect(calls).toBe(afterFirst); // no spam while known-down
    // Retry resumes attempts.
    fireEvent.click(screen.getByTestId('live-retry'));
    await tick(60);
    expect(calls).toBeGreaterThan(afterFirst);
  });

  it('AC5b: a throttled (429) request keeps the module live — no unavailable flip', async () => {
    let throttleCount = 0; // remaining requests to throttle
    const svc: LiveProcessingService = {
      process(c) {
        if (throttleCount > 0) {
          throttleCount--;
          return Promise.reject(new LiveThrottleError());
        }
        return Promise.resolve(validResult(c));
      },
    };
    render(
      <LiveView
        service={svc}
        parcelId="PKG-123"
        labelPayload="ANFISA-LIVE-1"
        captureIntervalMs={50}
        encodeFrame={stubEncode}
        decodeCropStage={okDecode}
      />,
    );
    await tick(60);
    await flush(); // first result -> live
    expect(screen.getByTestId('live-tile-raw-meta')).toHaveTextContent(/live-/);

    // Now throttle the next three emits.
    throttleCount = 3;
    await tick(300);
    await flush();
    // Still live: the last non-throttled result is on screen, no banner.
    expect(screen.queryByTestId('live-unavailable')).toBeNull();
    expect(screen.getByTestId('live-tile-raw-meta')).toHaveTextContent(/live-/);
  });

  it('decode tile shows the pixel-decoded value (existing ZXing path), not a fabrication', async () => {
    const svc = new ImmediateService();
    const decodeCalls: string[] = [];
    const decodeSpy = (stage: LiveStageImage) => {
      decodeCalls.push(stage.name);
      return Promise.resolve({ decoded: true, payload: 'ANFISA-LIVE-1', reasons: [] } as LiveCropDecode);
    };
    render(
      <LiveView
        service={svc}
        parcelId="PKG-123"
        labelPayload="ANFISA-LIVE-1"
        captureIntervalMs={50}
        encodeFrame={stubEncode}
        decodeCropStage={decodeSpy}
      />,
    );
    await tick(60);
    // every decode request targets the returned crop stage
    expect(decodeCalls.length).toBeGreaterThan(0);
    expect(decodeCalls.every((n) => n === 'decodeCrop')).toBe(true);
    expect(screen.getByTestId('live-decode-text')).toHaveTextContent('ANFISA-LIVE-1');
  });
});

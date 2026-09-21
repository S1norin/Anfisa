/**
 * Live-processing client tests (t7-1, sub-task s2).
 *
 *  - AC1 (contract): the result contract covers every required field —
 *    the runtime guard accepts a complete result and rejects a malformed
 *    one (the service is a separate process; the contract is its API).
 *  - AC2 (client): only the newest frame/strip of a camera is ever sent,
 *    at most one request in flight per camera, stale previews replaced
 *    (older results arriving late are dropped), independent per camera.
 *
 * All tests use a fake service — no network, no Python.
 */

import { describe, expect, it } from 'vitest';
import type {
  LiveCaptureInput,
  LiveProcessingResult,
  LiveProcessingService,
} from './contracts';
import { isLiveProcessingResult } from './contracts';
import { LiveProcessingClient } from './client';

/** One open (in-flight) service request under test control. */
interface OpenFlight {
  capture: LiveCaptureInput;
  resolve: (r: LiveProcessingResult) => void;
  reject: (e: unknown) => void;
}

class FakeService implements LiveProcessingService {
  open: OpenFlight[] = [];
  /** Per-flight scripted results (index by flight order). */
  scripted: Array<(capture: LiveCaptureInput) => LiveProcessingResult> = [];

  process(capture: LiveCaptureInput): Promise<LiveProcessingResult> {
    return new Promise((resolve, reject) => {
      this.open.push({ capture, resolve, reject });
    });
  }

  settleFlight(i: number, result?: LiveProcessingResult): void {
    const flight = this.open[i];
    if (!flight) throw new Error(`no open flight ${i}`);
    const maker =
      this.scripted[i] ??
      ((c: LiveCaptureInput) => validResult(c));
    flight.resolve(result ?? maker(flight.capture));
  }

  failFlight(i: number, error: unknown): void {
    this.open[i].reject(error);
  }
}

function makeCapture(cameraId: string, n: number): LiveCaptureInput {
  return {
    captureId: `${cameraId}-cap-${n}`,
    cameraId,
    sourceType: 'AREA_FRAME',
    simTimeMs: n * 33,
    encoderSpanMm: [100 + n, 100 + n],
    image: {
      data: new Uint8Array([0, 0, 0]),
      width: 4,
      height: 4,
      mime: 'image/png',
    },
  };
}

function validResult(capture: LiveCaptureInput): LiveProcessingResult {
  return {
    captureId: capture.captureId,
    seq: capture.seq ?? 0,
    cameraId: capture.cameraId,
    sourceType: capture.sourceType,
    simTimeMs: capture.simTimeMs,
    encoderSpanMm: [...capture.encoderSpanMm],
    stages: [
      {
        name: 'original',
        data: new Uint8Array([1, 2, 3]),
        mime: 'image/png',
        width: 4,
        height: 4,
      },
    ],
    decode: { decoded: true, decodedPayload: 'X1', reasons: [], confidence: 0.9 },
    processingMs: 12,
  };
}

/** Let the client's async drain chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AC1: the result contract covers every required field', () => {
  it('accepts a complete result', () => {
    const r = validResult({ ...makeCapture('cam-a', 1), seq: 1 });
    expect(isLiveProcessingResult(r)).toBe(true);
  });

  it('rejects results missing contract fields', () => {
    const r = validResult({ ...makeCapture('cam-a', 1), seq: 1 });
    expect(isLiveProcessingResult({ ...r, stages: undefined })).toBe(false);
    expect(isLiveProcessingResult({ ...r, processingMs: undefined })).toBe(false);
    expect(isLiveProcessingResult({ ...r, sourceType: 'MIXED' })).toBe(false);
    expect(
      isLiveProcessingResult({
        ...r,
        encoderSpanMm: [1],
      }),
    ).toBe(false);
    expect(
      isLiveProcessingResult({
        ...r,
        decode: { decoded: true }, // no reasons/confidence
      }),
    ).toBe(false);
  });

  it('covers parcelId (optional) and candidate coords (optional)', () => {
    const r = validResult({ ...makeCapture('cam-a', 1), seq: 1 });
    r.parcelId = 'P-1';
    r.candidate = { quadPx: [[0, 0], [10, 0], [10, 10], [0, 10]], source: 'pixels' };
    expect(isLiveProcessingResult(r)).toBe(true);
    delete r.parcelId;
    delete r.candidate;
    expect(isLiveProcessingResult(r)).toBe(true); // both optional
  });
});

describe('AC2: the client (fake service)', () => {
  it('sends a capture and applies its result as the preview', async () => {
    const svc = new FakeService();
    const client = new LiveProcessingClient(svc);
    const seen: LiveProcessingResult[] = [];
    client.onResult((r) => seen.push(r));

    client.submit(makeCapture('cam-a', 1));
    expect(svc.open.length).toBe(1);
    expect(client.isProcessing('cam-a')).toBe(true);

    svc.settleFlight(0);
    await flush();

    expect(seen.length).toBe(1);
    expect(seen[0].captureId).toBe('cam-a-cap-1');
    expect(client.lastResult('cam-a')?.captureId).toBe('cam-a-cap-1');
    expect(client.isProcessing('cam-a')).toBe(false);
  });

  it('at most one in-flight per camera; only the NEWEST capture is sent', async () => {
    const svc = new FakeService();
    const client = new LiveProcessingClient(svc);

    client.submit(makeCapture('cam-a', 1)); // flight 1
    await flush();
    client.submit(makeCapture('cam-a', 2)); // queued (flight 1 open)
    client.submit(makeCapture('cam-a', 3)); // replaces #2 in the queue
    expect(svc.open.length).toBe(1); // still ONE in flight

    svc.settleFlight(0);
    await flush();

    // Exactly two flights total; the second is the NEWEST capture (#3).
    expect(svc.open.length).toBe(2);
    expect(svc.open[0].capture.captureId).toBe('cam-a-cap-1');
    expect(svc.open[1].capture.captureId).toBe('cam-a-cap-3');
  });

  it('runs independent in-flight requests for two cameras in parallel', async () => {
    const svc = new FakeService();
    const client = new LiveProcessingClient(svc);

    client.submit(makeCapture('cam-a', 1));
    client.submit(makeCapture('cam-b', 1));
    await flush();
    expect(svc.open.length).toBe(2);
    expect(client.isProcessing('cam-a')).toBe(true);
    expect(client.isProcessing('cam-b')).toBe(true);
  });

  it('drops a stale result: an older seq arriving after a newer applied one', async () => {
    const svc = new FakeService();
    // Flight 2's service response carries an OLDER seq than what is
    // already applied (e.g. a retry of a superseded request) — the client
    // must not let it replace the preview.
    svc.scripted = [
      (c) => validResult(c), // flight 1: seq 1 applied
      (c) => ({ ...validResult(c), seq: 0 }), // flight 2: stale seq 0
    ];
    const client = new LiveProcessingClient(svc);
    const seen: LiveProcessingResult[] = [];
    client.onResult((r) => seen.push(r));

    client.submit(makeCapture('cam-a', 1));
    await flush();
    client.submit(makeCapture('cam-a', 2));
    svc.settleFlight(0);
    await flush();
    svc.settleFlight(1);
    await flush();

    expect(seen.length).toBe(1); // only the first result was shown
    expect(seen[0].seq).toBe(1);
    expect(client.lastResult('cam-a')?.seq).toBe(1);
  });

  it('newer results replace the preview (newest-wins)', async () => {
    const svc = new FakeService();
    const client = new LiveProcessingClient(svc);

    client.submit(makeCapture('cam-a', 1));
    await flush();
    client.submit(makeCapture('cam-a', 2));
    svc.settleFlight(0);
    await flush();
    svc.settleFlight(1);
    await flush();

    expect(client.lastResult('cam-a')?.captureId).toBe('cam-a-cap-2');
  });

  it('survives service failures and keeps draining the newest capture', async () => {
    const svc = new FakeService();
    const client = new LiveProcessingClient(svc);
    const errors: Array<[string, unknown]> = [];
    client.onError((cam, e) => errors.push([cam, e]));
    const seen: LiveProcessingResult[] = [];
    client.onResult((r) => seen.push(r));

    client.submit(makeCapture('cam-a', 1));
    await flush();
    client.submit(makeCapture('cam-a', 2)); // queued during flight 1
    svc.failFlight(0, new Error('service down'));
    await flush();

    expect(errors.length).toBe(1);
    expect(errors[0][0]).toBe('cam-a');
    // The newest capture was sent after the failure.
    expect(svc.open.length).toBe(2);
    expect(svc.open[1].capture.captureId).toBe('cam-a-cap-2');
    svc.settleFlight(1);
    await flush();
    expect(seen.length).toBe(1);
    expect(seen[0].captureId).toBe('cam-a-cap-2');
  });
});

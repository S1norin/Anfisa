/**
 * HTTP live service tests (t7-3): base64 wire mapping and the JSON →
 * contract mapping (the service is a separate process; the contract is
 * its API). No network — fetch is injected.
 */

import { describe, expect, it } from 'vitest';
import type { LiveCaptureInput, LiveProcessingService } from './contracts';
import {
  LiveThrottleError,
  base64ToBytes,
  bytesToBase64,
  createHttpLiveProcessingService,
  isLiveThrottled,
  mapResult,
} from './httpService';

function capture(): LiveCaptureInput {
  return {
    captureId: 'cap-1',
    cameraId: 'cam-side-1',
    sourceType: 'AREA_FRAME',
    simTimeMs: 100,
    encoderSpanMm: [10, 22],
    seq: 3,
    image: { data: new Uint8Array([1, 2, 3, 255]), width: 2, height: 2, mime: 'image/png' },
  };
}

describe('base64 wire encoding', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array(1000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i * 7 + 13;
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('mapResult', () => {
  it('decodes stage bytes and passes decode flags through', () => {
    const b64 = bytesToBase64(new Uint8Array([9, 8, 7]));
    const r = mapResult({
      captureId: 'cap-1',
      seq: 3,
      cameraId: 'cam-side-1',
      sourceType: 'AREA_FRAME',
      simTimeMs: 100,
      encoderSpanMm: [10, 22],
      stages: [{ name: 'maskedCrop', dataB64: b64, mime: 'image/png', width: 2, height: 2 }],
      candidate: { quadPx: [[1, 2], [3, 2], [3, 4], [1, 4]], source: 'pixels' },
      decode: { decoded: false, pending: true, reasons: [], confidence: 0 },
      processingMs: 12.5,
    });
    expect(r.stages[0].data).toEqual(new Uint8Array([9, 8, 7]));
    expect(r.candidate?.source).toBe('pixels');
    expect(r.decode.pending).toBe(true);
  });

  it('maps a null candidate to undefined and keeps parcelId optional', () => {
    const r = mapResult({
      captureId: 'cap-1',
      seq: 1,
      cameraId: 'ls-top',
      sourceType: 'LINE_STRIP',
      simTimeMs: 0,
      encoderSpanMm: [0, 0],
      stages: [],
      candidate: null,
      decode: { decoded: false, reasons: ['QUALITY:GLARE'], confidence: 0 },
      processingMs: 1,
    });
    expect(r.candidate).toBeUndefined();
    expect(r.parcelId).toBeUndefined();
    expect(r.decode.reasons).toEqual(['QUALITY:GLARE']);
  });
});

describe('createHttpLiveProcessingService', () => {
  it('POSTs the exact capture and returns the mapped result', async () => {
    const seen: [string, RequestInit][] = [];
    const b64 = bytesToBase64(new Uint8Array([5, 6]));
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push([url, init]);
      return new Response(
        JSON.stringify({
          captureId: 'cap-1',
          seq: 3,
          cameraId: 'cam-side-1',
          sourceType: 'AREA_FRAME',
          simTimeMs: 100,
          encoderSpanMm: [10, 22],
          stages: [{ name: 'raw', dataB64: b64, mime: 'image/png', width: 1, height: 1 }],
          candidate: null,
          decode: { decoded: false, reasons: [], confidence: 0 },
          processingMs: 9,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    const svc: LiveProcessingService = createHttpLiveProcessingService({
      baseUrl: 'http://127.0.0.1:8790/',
      fetchImpl: fakeFetch,
    });
    const r = await svc.process(capture());
    expect(seen.length).toBe(1);
    expect(seen[0][0]).toBe('http://127.0.0.1:8790/process');
    const body = JSON.parse(String(seen[0][1].body));
    expect(body.imageB64).toBe(bytesToBase64(new Uint8Array([1, 2, 3, 255])));
    expect(body.seq).toBe(3);
    expect(r.stages[0].data).toEqual(new Uint8Array([5, 6]));
  });

  it('rejects on non-200 (the UI shows unavailable)', async () => {
    const fakeFetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    const svc = createHttpLiveProcessingService({ fetchImpl: fakeFetch });
    await expect(svc.process(capture())).rejects.toThrow(/500/);
  });

  it('429 rejects with a typed throttle marker (flow control, not outage)', async () => {
    const fakeFetch = (async () => new Response('throttled', { status: 429 })) as typeof fetch;
    const svc = createHttpLiveProcessingService({ fetchImpl: fakeFetch });
    const err: unknown = await svc.process(capture()).catch((e) => e);
    expect(err).toBeInstanceOf(LiveThrottleError);
    expect(isLiveThrottled(err)).toBe(true);
    expect(isLiveThrottled(new Error('HTTP 500'))).toBe(false);
  });
});

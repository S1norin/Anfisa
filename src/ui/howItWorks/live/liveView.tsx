/**
 * Live Processing module (t7-3) — a SEPARATE module inside the How It
 * Works page, not a second guided-replay storyboard.
 *
 *  - camera selector: top/bottom line scan + six side cameras; the
 *    selected camera + parcel ID are prominent;
 *  - live comparison grid of 6 tiles (raw, masked/ROI, grayscale/
 *    contrast, edge map, candidate/rectified crop, decode) — every tile
 *    carries the SAME captureId + encoder span of the selected camera's
 *    newest result;
 *  - compact event strip (capture → … → final result) with the matching
 *    sensor highlighted in 3D;
 *  - pause/freeze holds all tiles on one capture; resume follows the
 *    newest; processing lag + dropped preview frames are displayed;
 *  - with the service unavailable the screen says 'Live Processing
 *    unavailable' — Guided Replay (the mode toggle above) stays usable.
 *
 * No physical cameras: the sensors are deterministic synthetic sources
 * (syntheticCameras) carrying real Code 128 pixels. All processing is
 * done by the service (t7-2); the UI runs no image filters — the only
 * browser compute is the decode tile, which decodes the returned crop
 * through the EXISTING ZXing path (liveDecode → zxingDecodeFrame).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { defaultConfig } from '../../../domain/config';
import type { ParcelState } from '../../../domain/types';
import { StationScene } from '../../../scene/stationScene';
import { ParcelScene } from '../../../scene/parcel';
import type { PixelFrame } from '../../../pipeline/pixelDecoder';
import { LiveProcessingClient } from '../../../live-processing/client';
import type {
  LiveProcessingResult,
  LiveProcessingService,
  LiveStageImage,
} from '../../../live-processing/contracts';
import {
  base64ToBytes,
  bytesToBase64,
  isLiveThrottled,
} from '../../../live-processing/httpService';
import {
  LIVE_CAMERAS,
  liveCameraKind,
  liveCameraLabel,
  makeSyntheticFrame,
  syntheticCapture,
  type LiveCameraId,
} from './syntheticCameras';
import { decodeLiveCrop, type LiveCropDecode } from './liveDecode';
import { LiveEventStrip } from './eventStrip';
import { SideCameraCaptureHighlight, type SideCamId } from '../step5SideCameras';
import {
  LineScanCaptureHighlight,
  bottomExposedZRange,
} from '../step2Capture';

/* ---------------- canvas seams (browser) / injected (headless) ------- */

function has2dCanvas(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('2d'));
  } catch {
    return false;
  }
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

/** Browser: PixelFrame → PNG bytes via a canvas (toDataURL). */
export function canvasEncodeFrame(frame: PixelFrame): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = frame.widthPx;
  canvas.height = frame.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('no 2d canvas context'));
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(frame.data), frame.widthPx, frame.heightPx),
    0,
    0,
  );
  const b64 = canvas.toDataURL('image/png').split(',')[1];
  return Promise.resolve(base64ToBytes(b64));
}

/** Browser: PNG bytes → PixelFrame via an Image (decode + getImageData). */
export function canvasDecodeCropBytes(
  bytes: Uint8Array,
): Promise<PixelFrame> {
  const img = new Image();
  img.src = `data:image/png;base64,${bytesToBase64(bytes)}`;
  return img.decode().then(() => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d canvas context');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      widthPx: canvas.width,
      heightPx: canvas.height,
    };
  });
}

/** Headless fallback encoder (tests): placeholder 1×1 PNG-ish bytes. */
function stubEncodeFrame(frame: PixelFrame): Promise<Uint8Array> {
  return Promise.resolve(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, frame.widthPx & 0xff, frame.heightPx & 0xff]),
  );
}

/* ---------------- live parcel (independent of the guided clock) ------ */

/** The live parcel travels the station on its own wall-clock. */
export function liveFrontZAt(tMs: number, stationLengthMm: number): number {
  const span = stationLengthMm + 400;
  return ((tMs * 0.35) % span) - 200;
}

export function liveParcelAt(
  parcelId: string,
  payload: string,
  frontZMm: number,
): ParcelState {
  return {
    parcelId,
    spec: {
      widthMm: 250,
      heightMm: 220,
      lengthMm: 350,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: true,
      labels: [
        {
          labelInstanceId: 'L-live',
          payload,
          face: 'FRONT',
          localOffsetMm: [0, 0] as [number, number],
          rotationDeg: 0,
          widthMm: 180,
          heightMm: 90,
          damage: 0,
        },
      ],
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: frontZMm,
    frontZMm,
    phase: 'ENTERED',
  };
}

/* ---------------- 3D panel -------------------------------------------- */

function LiveScenePanel({
  camera,
  frontZMm,
  parcelId,
  labelPayload,
}: {
  camera: LiveCameraId;
  frontZMm: number;
  parcelId: string;
  labelPayload: string;
}) {
  const config = useMemo(() => defaultConfig(), []);
  if (!hasWebGL()) {
    return (
      <div
        className="hiw-live-3d-fallback"
        data-testid="live-3d-fallback"
        role="status"
      >
        3D view unavailable: WebGL is not supported in this browser.
      </div>
    );
  }
  const parcel = liveParcelAt(parcelId, labelPayload, frontZMm);
  const isSide = camera.startsWith('cam-side-');
  const isBottom = camera === 'ls-bottom';
  const [gap0, gap1] = bottomExposedZRange(config);
  const exposed = !isBottom || (gap1 > frontZMm - 6 && gap0 < frontZMm + 6);
  return (
    <section className="hiw-live-3d" data-testid="live-3d-panel">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [2.4, 1.6, 3.4], fov: 45, near: 0.05, far: 100 }}
      >
        <color attach="background" args={['#161a20']} />
        <ambientLight intensity={0.22} />
        <directionalLight position={[4, 6, 3]} intensity={0.32} />
        <StationScene config={config} />
        <ParcelScene state={parcel} />
        {isSide ? (
          <SideCameraCaptureHighlight selectedId={camera as SideCamId} />
        ) : (
          <LineScanCaptureHighlight
            beltWidthMm={config.belt.widthMm}
            z0Mm={frontZMm - 6}
            z1Mm={frontZMm + 6}
            exposed={exposed}
          />
        )}
      </Canvas>
    </section>
  );
}

/* ---------------- the module ------------------------------------------ */

export interface LiveViewProps {
  service: LiveProcessingService;
  /** The parcel currently on the line (association target). */
  parcelId: string;
  /** Label payload the synthetic cameras render on the parcel. */
  labelPayload?: string;
  /** Emit interval for the selected camera (ms). Default 600. */
  captureIntervalMs?: number;
  /** PixelFrame → image bytes (browser: canvas; tests: stub). */
  encodeFrame?: (f: PixelFrame) => Promise<Uint8Array>;
  /** decodeCrop stage → browser ZXing outcome (tests: scripted). */
  decodeCropStage?: (stage: LiveStageImage) => Promise<LiveCropDecode>;
}

const TILE_DEFS = [
  { key: 'raw', label: 'raw capture' },
  { key: 'maskedCrop', label: 'masked / ROI' },
  { key: 'grayscaleContrast', label: 'grayscale + contrast' },
  { key: 'edgeMap', label: 'edge map' },
  { key: 'candidateOverlay', label: 'candidate' },
  { key: 'decode', label: 'decode' },
] as const;

type TileKey = (typeof TILE_DEFS)[number]['key'];

export function LiveView({
  service,
  parcelId,
  labelPayload = 'ANFISA-LIVE-1',
  captureIntervalMs = 600,
  encodeFrame,
  decodeCropStage,
}: LiveViewProps) {
  const encoder = useMemo(
    () => encodeFrame ?? (has2dCanvas() ? canvasEncodeFrame : stubEncodeFrame),
    [encodeFrame],
  );
  const cropDecoder = useMemo(
    () =>
      decodeCropStage ??
      (has2dCanvas()
        ? (stage: LiveStageImage) => decodeLiveCrop(stage, canvasDecodeCropBytes)
        : async () => ({
            decoded: false,
            reasons: ['DECODE:CANVAS_UNAVAILABLE'],
          })),
    [decodeCropStage],
  );

  const [camera, setCamera] = useState<LiveCameraId>('cam-side-1');
  const [paused, setPaused] = useState(false);
  /** Until the first service result the module shows 'unavailable'. */
  const [status, setStatus] = useState<'connecting' | 'live' | 'unavailable'>('connecting');
  const [results, setResults] = useState<Record<string, LiveProcessingResult>>({});
  const [lastRaw, setLastRaw] = useState<
    Record<string, { data: Uint8Array; mime: string; width: number; height: number }>
  >({});
  const [decodes, setDecodes] = useState<Record<string, LiveCropDecode>>({});
  const [tMs, setTMs] = useState(0);
  const [pulse, setPulse] = useState(0);
  void pulse; // render tick for async result/decode updates

  const config = useMemo(() => defaultConfig(), []);
  const stationLengthMm = config.station.lengthMm;
  const frontZMm = liveFrontZAt(tMs, stationLengthMm);
  const frontZRef = useRef(frontZMm);
  frontZRef.current = frontZMm;
  const tMsRef = useRef(tMs);
  tMsRef.current = tMs;

  // The client is stable per service identity.
  const serviceRef = useRef(service);
  const clientRef = useRef<LiveProcessingClient | null>(null);
  if (serviceRef.current !== service || clientRef.current === null) {
    serviceRef.current = service;
    clientRef.current = new LiveProcessingClient(service);
  }
  const client = clientRef.current;

  const emittedRef = useRef<Record<string, number>>({});
  const appliedRef = useRef<Record<string, number>>({});
  const submitAtRef = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  const encoderRef = useRef(encoder);
  encoderRef.current = encoder;
  const cropDecoderRef = useRef(cropDecoder);
  cropDecoderRef.current = cropDecoder;

  // Client wiring: newest-wins results per camera; decode the crop the
  // service returned through the existing ZXing path.
  useEffect(() => {
    const offResult = client.onResult((r) => {
      setResults((prev) => ({ ...prev, [r.cameraId]: r }));
      setStatus((s) => (s === 'unavailable' ? s : 'live'));
      appliedRef.current[r.cameraId] = (appliedRef.current[r.cameraId] ?? 0) + 1;
      setPulse((p) => p + 1);
      const crop = r.stages.find((s) => s.name === 'decodeCrop');
      if (crop && r.decode.pending) {
        void cropDecoderRef
          .current(crop)
          .then((d) => setDecodes((prev) => ({ ...prev, [r.captureId]: d })))
          .catch(() =>
            setDecodes((prev) => ({
              ...prev,
              [r.captureId]: { decoded: false, reasons: ['DECODE:ENGINE_ERROR'] },
            })),
          )
          .finally(() => setPulse((p) => p + 1));
      }
    });
    const offError = client.onError((_cameraId, error) => {
      // A per-camera throttle (429) is expected flow control — keep the
      // current state; the next scheduled emit retries naturally.
      if (isLiveThrottled(error)) return;
      setStatus('unavailable');
      setPulse((p) => p + 1);
    });
    return () => {
      offResult();
      offError();
    };
  }, [client]);

  // Live wall clock (drives the 3D parcel + sim timestamps).
  useEffect(() => {
    if (paused) return;
    let t = tMsRef.current;
    const id = setInterval(() => {
      t += 16;
      tMsRef.current = t;
      frontZRef.current = liveFrontZAt(t, stationLengthMm);
      setTMs(t);
    }, 16);
    return () => clearInterval(id);
  }, [paused, stationLengthMm]);

  // Synthetic source: the SELECTED camera's newest frames only (the
  // client enforces one in-flight + one queued per camera). The effect
  // stays mounted across status flips (the capture sequence `n` is not
  // reset); emits are skipped while the service is known-down.
  useEffect(() => {
    if (paused) return;
    let n = 0;
    let disposed = false;
    const emit = () => {
      if (statusRef.current === 'unavailable') return;
      const frame = makeSyntheticFrame(camera, labelPayload, n);
      void (async () => {
        const bytes = await encoderRef.current(frame);
        if (disposed) return;
        const cap = syntheticCapture(
          camera,
          n,
          { data: bytes, width: frame.widthPx, height: frame.heightPx, mime: 'image/png' },
          tMsRef.current,
          frontZRef.current,
        );
        setLastRaw((prev) => ({
          ...prev,
          [camera]: { data: bytes, mime: cap.image.mime, width: cap.image.width, height: cap.image.height },
        }));
        emittedRef.current[camera] = (emittedRef.current[camera] ?? 0) + 1;
        submitAtRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
        client.submit(cap);
        n++;
      })();
    };
    emit();
    const id = setInterval(emit, captureIntervalMs);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [camera, paused, client, captureIntervalMs, labelPayload]);

  // ---- derived (render) state ------------------------------------------
  const result = results[camera] ?? null;
  const raw = lastRaw[camera];
  const stageFor = (name: string): LiveStageImage | null =>
    result?.stages.find((s) => s.name === name) ?? null;
  const decodeStage = stageFor('decodeCrop');
  const cropOutcome = result ? (decodes[result.captureId] ?? null) : null;
  const inFlight = client.isProcessing(camera);
  const flightMs =
    inFlight && submitAtRef.current > 0
      ? Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - submitAtRef.current))
      : 0;
  const lagText = result
    ? `service ${Math.round(result.processingMs)} ms${inFlight ? ` · in flight ${flightMs} ms` : ''}`
    : '—';
  const dropped = Math.max(
    0,
    (emittedRef.current[camera] ?? 0) - (appliedRef.current[camera] ?? 0) - 2,
  );
  const metaLine = result
    ? `${result.captureId} · encoder ${result.encoderSpanMm[0]}–${result.encoderSpanMm[1]} mm`
    : 'awaiting first result';
  const dataUrl = (stage: LiveStageImage) =>
    `data:${stage.mime};base64,${bytesToBase64(stage.data)}`;
  const rawUrl = raw ? `data:${raw.mime};base64,${bytesToBase64(raw.data)}` : null;

  const tileImage = (key: TileKey): string | null => {
    if (key === 'raw') return rawUrl;
    if (key === 'decode') return decodeStage ? dataUrl(decodeStage) : null;
    const s = stageFor(key);
    return s ? dataUrl(s) : null;
  };
  const decodeDetail = (): string => {
    if (cropOutcome?.decoded) return cropOutcome.payload ?? '';
    if (cropOutcome) return cropOutcome.reasons.join(' ');
    if (result?.decode.pending) return 'decoding…';
    if (result && result.decode.reasons.length > 0) return result.decode.reasons.join(' ');
    return '—';
  };

  return (
    <div className="hiw-live" data-testid="live-view">
      <div className="hiw-live-topbar">
        <div className="hiw-live-parcel-chip" data-testid="live-parcel-chip">
          <span className="hiw-live-parcel-id" data-testid="live-parcel-id">
            {parcelId}
          </span>
          <span className="hiw-live-camera" data-testid="live-selected-camera">
            {liveCameraLabel(camera)}
          </span>
          <span className="hiw-live-source-type" data-testid="live-source-type">
            {liveCameraKind(camera)}
          </span>
        </div>
        <div
          className="hiw-live-cam-select"
          role="group"
          aria-label="Live camera"
          data-testid="live-cam-select"
        >
          {LIVE_CAMERAS.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid={`live-cam-${c.id}`}
              aria-pressed={camera === c.id}
              onClick={() => setCamera(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="hiw-live-pause"
          data-testid="live-pause"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? 'resume' : 'pause'}
        </button>
        <div className="hiw-live-metrics">
          <span data-testid="live-lag">{lagText}</span>
          <span data-testid="live-dropped" data-dropped={dropped}>
            {dropped} dropped preview frame{dropped === 1 ? '' : 's'}
          </span>
        </div>
        {status === 'unavailable' && (
          <button
            type="button"
            className="hiw-live-retry"
            data-testid="live-retry"
            onClick={() => {
              setStatus('connecting');
              setPulse((p) => p + 1);
            }}
          >
            retry
          </button>
        )}
      </div>

      <LiveEventStrip result={result} cropDecode={cropOutcome} parcelId={parcelId} />

      {status !== 'live' && (
        <div
          className="hiw-live-unavailable"
          data-testid="live-unavailable"
          role="status"
        >
          <strong>Live Processing unavailable</strong>
          {status === 'unavailable' ? (
            <span>
              {' '}— the service did not answer. Start it with{' '}
              <code>python3 services/live_processing/app.py</code> and retry.
              Guided Replay (mode toggle above) remains usable.
            </span>
          ) : (
            <span>
              {' '}— connecting to the live service
              <code> python3 services/live_processing/app.py</code>. Guided
              Replay (mode toggle above) remains usable.
            </span>
          )}
        </div>
      )}

      <div className="hiw-live-panels">
        <LiveScenePanel
          camera={camera}
          frontZMm={frontZMm}
          parcelId={parcelId}
          labelPayload={labelPayload}
        />
        <div className="hiw-live-tiles" data-testid="live-tiles">
          {TILE_DEFS.map((t) => {
            const img = tileImage(t.key);
            return (
              <figure
                key={t.key}
                className="hiw-live-tile"
                data-testid={`live-tile-${t.key}`}
              >
                <figcaption className="hiw-live-tile-head">
                  <span>{t.label}</span>
                  <span className="hiw-live-tile-meta" data-testid={`live-tile-${t.key}-meta`}>
                    {metaLine}
                  </span>
                </figcaption>
                {t.key === 'decode' ? (
                  <div className="hiw-live-decode" data-testid="live-decode-value">
                    {img && <img src={img} alt="decode crop" data-testid="live-tile-decode-img" />}
                    <span data-testid="live-decode-text">{decodeDetail()}</span>
                  </div>
                ) : (
                  img && (
                    <img
                      src={img}
                      alt={t.label}
                      data-testid={`live-tile-${t.key}-img`}
                    />
                  )
                )}
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { frameBuffer, stripBufferPool } from '../capture/frameBuffer';
import { simStore, useSim } from '../store/simStore';
import type { CameraConfig, CameraState } from '../domain/types';

/**
 * Camera feed wall (CAM-008, issue #6, live in issue #11): one tile per
 * camera showing cameraId, state, frame age, visible parcel ids, decoded
 * count, and warning state. Metadata-only (NFR-002: textures are
 * display-only; the feed shows what the capture pipeline knows, not
 * decoded pixels).
 *
 * The decoded count comes from the LIVE pipeline's observation log
 * (same data the result card and metrics use), keyed by camera + capture
 * sim time — the display-only frame buffer itself carries no labels.
 */

const STALE_AFTER_MS = 1000;

interface TileProps {
  rig: CameraConfig;
  state: CameraState | undefined;
  simTimeMs: number;
  decodedByFrame: ReadonlyMap<string, number>;
}

function CameraTile({ rig, state, simTimeMs, decodedByFrame }: TileProps) {
  const latest = frameBuffer.latest(rig.id);
  // Line scanners: the newest encoder-mapped strip reconstruction
  // (t9, display-only — decode never reads these pixels, NFR-002).
  const strip =
    rig.kind === 'LINE_SCAN' ? stripBufferPool.latest(rig.id) : undefined;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strip) return;
    canvas.width = strip.widthPx;
    canvas.height = strip.heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom: no 2D context (display-only path)
    const img = ctx.createImageData(strip.widthPx, strip.heightPx);
    img.data.set(strip.data);
    ctx.putImageData(img, 0, 0);
  }, [strip]);

  const ageMs = latest ? simTimeMs - latest.simTimeMs : null;
  const decoded = latest
    ? decodedByFrame.get(`${rig.id}@${latest.simTimeMs}`) ?? 0
    : 0;

  const warnings: string[] = [];
  if (state === 'FAULT') warnings.push('FAULT');
  if (!rig.enabled) warnings.push('DISABLED');
  if (state === 'OFFLINE') warnings.push('OFFLINE');
  if (latest && ageMs! > STALE_AFTER_MS) warnings.push('STALE');
  if (!latest && rig.enabled && state !== 'FAULT') warnings.push('NO_FRAMES');

  const parcelIds = latest?.candidateParcelIds ?? [];
  const shown = parcelIds.slice(0, 4);
  const extra = parcelIds.length - shown.length;

  return (
    <article className="cam-tile" data-testid={`cam-tile-${rig.id}`}>
      <header className="cam-tile-head">
        <span className="cam-tile-id">{rig.id}</span>
        <span className={`cam-tile-state state-${state ?? 'OFFLINE'}`}>
          {state ?? 'OFFLINE'}
        </span>
        <button
          type="button"
          className="cam-tile-fault"
          onClick={() => simStore.setCameraFault(rig.id, state !== 'FAULT')}
          data-testid={`cam-tile-fault-${rig.id}`}
        >
          {state === 'FAULT' ? 'Clear' : 'Fault'}
        </button>
      </header>
      <dl className="cam-tile-data">
        <div>
          <dt>Frame age</dt>
          <dd data-testid={`cam-tile-age-${rig.id}`}>
            {ageMs === null ? '—' : `${Math.max(0, Math.round(ageMs))} ms`}
          </dd>
        </div>
        <div>
          <dt>Parcels</dt>
          <dd data-testid={`cam-tile-parcels-${rig.id}`}>
            {parcelIds.length === 0
              ? '—'
              : [...shown, extra > 0 ? `+${extra}` : null].join(' ')}
          </dd>
        </div>
        <div>
          <dt>Decoded</dt>
          <dd data-testid={`cam-tile-decoded-${rig.id}`}>{decoded}</dd>
        </div>
      </dl>
      {rig.kind === 'LINE_SCAN' && (
        <div className="cam-tile-strip" data-testid={`cam-tile-strip-${rig.id}`}>
          <canvas
            ref={canvasRef}
            className="cam-tile-strip-canvas"
            data-testid={`cam-tile-strip-canvas-${rig.id}`}
            width={strip?.widthPx ?? 1}
            height={strip?.heightPx ?? 1}
          />
          <span
            className="cam-tile-strip-label"
            data-testid={`cam-tile-strip-label-${rig.id}`}
          >
            Line scanner reconstruction
          </span>
        </div>
      )}
      {warnings.length > 0 && (
        <p className="cam-tile-warn" data-testid={`cam-tile-warn-${rig.id}`}>
          {warnings.join(' · ')}
        </p>
      )}
    </article>
  );
}

export function CameraWall() {
  const sim = useSim();
  const { config, cameraStates, simTimeMs } = sim.state;

  // Rebuilt on every render (this component re-renders on each sim tick):
  // liveObservations is a stable, in-place-mutated array, so a memo keyed on
  // its reference would never invalidate.
  const observations = simStore.liveObservations;
  const decodedByFrame = new Map<string, number>();
  for (const o of observations) {
    if (!o.decoded) continue;
    const key = `${o.cameraId}@${o.simTimeMs}`;
    decodedByFrame.set(key, (decodedByFrame.get(key) ?? 0) + 1);
  }

  return (
    <div className="camera-wall" data-testid="camera-wall">
      {config.cameraRigs.map((rig) => (
        <CameraTile
          key={rig.id}
          rig={rig}
          state={cameraStates[rig.id]}
          simTimeMs={simTimeMs}
          decodedByFrame={decodedByFrame}
        />
      ))}
    </div>
  );
}

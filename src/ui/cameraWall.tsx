import { frameBuffer } from '../capture/frameBuffer';
import { simStore, useSim } from '../store/simStore';
import type { CameraConfig, CameraState } from '../domain/types';

/**
 * Camera feed wall (CAM-008, issue #6): one tile per camera showing
 * cameraId, state, frame age, visible parcel ids, decoded count, and
 * warning state. Metadata-only (NFR-002: textures are display-only; the
 * feed shows what the capture pipeline knows, not decoded pixels).
 */

const STALE_AFTER_MS = 1000;

interface TileProps {
  rig: CameraConfig;
  state: CameraState | undefined;
  simTimeMs: number;
}

function CameraTile({ rig, state, simTimeMs }: TileProps) {
  const latest = frameBuffer.latest(rig.id);
  const ageMs = latest ? simTimeMs - latest.simTimeMs : null;
  const decoded = latest
    ? latest.labels.filter((l) => l.decodedPayload).length
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

  return (
    <div className="camera-wall" data-testid="camera-wall">
      {config.cameraRigs.map((rig) => (
        <CameraTile
          key={rig.id}
          rig={rig}
          state={cameraStates[rig.id]}
          simTimeMs={simTimeMs}
        />
      ))}
    </div>
  );
}

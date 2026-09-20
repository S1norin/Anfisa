/**
 * Camera rig editor (CAM-002, CFG-001, NFR-007).
 *
 * Every candidate edit is validated against the full rig list BEFORE it is
 * applied; invalid values are never committed and the first validation
 * message is shown. CRUD: add / clone / delete / enable-disable.
 */

import { useState } from 'react';
import {
  cloneCameraRig,
  defaultCameraRigs,
  lookAtQuaternion,
  nextCameraId,
  removeCameraRig,
  setCameraRigEnabled,
  validateCameraRigs,
  type Quat,
} from '../domain/camera';
import type { SimConfig } from '../domain/config';
import type { AreaScanCameraConfig, CameraConfig, CameraRole, CameraState } from '../domain/types';

const ROLES: CameraRole[] = [
  'FRONT',
  'REAR',
  'LEFT',
  'RIGHT',
  'TOP',
  'BOTTOM',
  'CUSTOM',
];

interface CameraEditorProps {
  config: SimConfig;
  states: Record<string, CameraState>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Commit a config edit (store applies + re-syncs camera states). */
  onCommit: (mutator: (cfg: SimConfig) => SimConfig) => void;
}

/** A fresh CUSTOM rig parked at the station entrance (demo assumption). */
function newCustomRig(cfg: SimConfig): CameraConfig {
  const base = defaultCameraRigs(
    {
      lengthMm: cfg.station.lengthMm,
      beltWidthMm: cfg.belt.widthMm,
    },
    {
      sensorWidthPx: cfg.cameras.sensorWidthPx,
      sensorHeightPx: cfg.cameras.sensorHeightPx,
      focalLengthMm: cfg.cameras.focalLengthMm,
      exposureUs: cfg.cameras.exposureUs,
      fps: cfg.cameras.fps,
      shutter: cfg.cameras.shutter,
    },
  )[5]; // reuse the BOTTOM pose defaults, re-pointed
  const id = nextCameraId(cfg.cameraRigs);
  const eye: [number, number, number] = [0, 1500, -600];
  const target: [number, number, number] = [0, 0, cfg.station.lengthMm / 2];
  const q: Quat = lookAtQuaternion(eye, target);
  return {
    ...base,
    id,
    name: `Custom ${id}`,
    role: 'CUSTOM',
    pose: { positionMm: eye, quaternion: q },
  };
}

function Field({
  label,
  value,
  onValue,
}: {
  label: string;
  value: number;
  onValue: (n: number) => void;
}) {
  return (
    <label className="cam-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onValue(n);
        }}
      />
    </label>
  );
}

export function CameraEditor({
  config,
  states,
  selectedId,
  onSelect,
  onCommit,
}: CameraEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const rigs = config.cameraRigs;
  const selected = rigs.find((r) => r.id === selectedId) ?? null;

  /** Validate-then-apply: never commits an invalid rig list. */
  const applyRigs = (next: CameraConfig[]) => {
    const errors = validateCameraRigs(next);
    if (errors.length > 0) {
      setError(`${errors[0].path}: ${errors[0].message}`);
      return;
    }
    setError(null);
    onCommit((cfg) => ({ ...cfg, cameraRigs: next }));
  };

  const patchSelected = (patch: (r: CameraConfig) => CameraConfig) => {
    if (!selected) return;
    applyRigs(rigs.map((r) => (r.id === selected.id ? patch(r) : r)));
  };

  /** Area-rig-only patches (sensor/acquisition/optics/illumination). */
  const patchSelectedArea = (
    patch: (r: AreaScanCameraConfig) => AreaScanCameraConfig,
  ) => {
    if (!selected || selected.kind !== 'AREA_SCAN') return;
    applyRigs(
      rigs.map((r) =>
        r.id === selected.id ? (patch(r as AreaScanCameraConfig) as CameraConfig) : r,
      ),
    );
  };

  return (
    <div className="camera-editor" data-testid="camera-editor">
      <div className="cam-row">
        <button
          type="button"
          onClick={() => applyRigs([...rigs, newCustomRig(config)])}
        >
          + Add camera
        </button>
        {selected && (
          <>
            <button
              type="button"
              onClick={() =>
                applyRigs(
                  cloneCameraRig(rigs, selected.id, nextCameraId(rigs)),
                )
              }
            >
              Clone
            </button>
            <button
              type="button"
              onClick={() => {
                applyRigs(removeCameraRig(rigs, selected.id));
                onSelect(null);
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>

      <ul className="cam-list">
        {rigs.map((r) => (
          <li
            key={r.id}
            className={r.id === selectedId ? 'cam-item selected' : 'cam-item'}
            onClick={() => onSelect(r.id === selectedId ? null : r.id)}
          >
            <span className="cam-name">{r.name}</span>
            <span className="cam-role">{r.role}</span>
            <span className="cam-state">{states[r.id] ?? 'OFFLINE'}</span>
            <button
              type="button"
              data-testid={`cam-toggle-${r.id}`}
              onClick={(e) => {
                e.stopPropagation();
                applyRigs(setCameraRigEnabled(rigs, r.id, !r.enabled));
              }}
            >
              {r.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <div className="cam-detail">
          <h3>
            {selected.id} — {states[selected.id] ?? 'OFFLINE'}
          </h3>
          <label className="cam-field">
            <span>Name</span>
            <input
              type="text"
              value={selected.name}
              onChange={(e) =>
                patchSelected((r) => ({ ...r, name: e.target.value }))
              }
            />
          </label>
          <label className="cam-field">
            <span>Role</span>
            <select
              value={selected.role}
              onChange={(e) =>
                patchSelected((r) => ({
                  ...r,
                  role: e.target.value as CameraRole,
                }))
              }
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <div className="cam-section">Position (mm)</div>
          <div className="cam-grid">
            {(['x', 'y', 'z'] as const).map((axis, i) => (
              <Field
                key={axis}
                label={axis.toUpperCase()}
                value={selected.pose.positionMm[i]}
                onValue={(n) =>
                  patchSelected((r) => {
                    const p = [...r.pose.positionMm] as [
                      number,
                      number,
                      number,
                    ];
                    p[i] = n;
                    return { ...r, pose: { ...r.pose, positionMm: p } };
                  })
                }
              />
            ))}
          </div>

          {selected.kind === 'AREA_SCAN' ? (
            <>
          <div className="cam-section">Sensor</div>
          <div className="cam-grid">
            <Field
              label="Width px"
              value={selected.sensor.widthPx}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  sensor: { ...r.sensor, widthPx: n },
                }))
              }
            />
            <Field
              label="Height px"
              value={selected.sensor.heightPx}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  sensor: { ...r.sensor, heightPx: n },
                }))
              }
            />
            <Field
              label="Focal mm"
              value={selected.sensor.focalLengthMm}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  sensor: { ...r.sensor, focalLengthMm: n },
                }))
              }
            />
            <Field
              label="Film gauge mm"
              value={selected.sensor.filmGaugeMm}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  sensor: { ...r.sensor, filmGaugeMm: n },
                }))
              }
            />
            <Field
              label="Near mm"
              value={selected.sensor.nearMm}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  sensor: { ...r.sensor, nearMm: n },
                }))
              }
            />
            <Field
              label="Far mm"
              value={selected.sensor.farMm}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  sensor: { ...r.sensor, farMm: n },
                }))
              }
            />
          </div>

          <div className="cam-section">Acquisition</div>
          <div className="cam-grid">
            <Field
              label="FPS"
              value={selected.acquisition.fps}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  acquisition: { ...r.acquisition, fps: n },
                }))
              }
            />
            <Field
              label="Exposure µs"
              value={selected.acquisition.exposureUs}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  acquisition: { ...r.acquisition, exposureUs: n },
                }))
              }
            />
            <Field
              label="Gain dB"
              value={selected.acquisition.gainDb}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  acquisition: { ...r.acquisition, gainDb: n },
                }))
              }
            />
          </div>

          <div className="cam-section">Illumination</div>
          <div className="cam-grid">
            <Field
              label="Intensity"
              value={selected.illumination.intensity}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  illumination: { ...r.illumination, intensity: n },
                }))
              }
            />
            <Field
              label="Strobe µs"
              value={selected.illumination.strobeUs}
              onValue={(n) =>
                patchSelectedArea((r) => ({
                  ...r,
                  illumination: { ...r.illumination, strobeUs: n },
                }))
              }
            />
          </div>
            </>
          ) : (
            <p className="cam-section">
              Line-scan rig — line fields (sensor width, encoder step, scan
              plane, line rate) are editable in t10.
            </p>
          )}

          <label className="cam-field cam-check">
            <input
              type="checkbox"
              checked={selected.preview.overlay}
              onChange={(e) =>
                patchSelected((r) => ({
                  ...r,
                  preview: { ...r.preview, overlay: e.target.checked },
                }))
              }
            />
            <span>Preview overlay</span>
          </label>
        </div>
      )}

      {error && (
        <div className="cam-error" data-testid="camera-editor-error">
          {error}
        </div>
      )}
    </div>
  );
}

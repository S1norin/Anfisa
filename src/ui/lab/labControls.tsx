/**
 * Camera Lab controls (issue #12, t12-1/t12-3): one camera + one parcel
 * at a frozen instant, with full rig editing. Every candidate edit is
 * validated with validateCameraRigs BEFORE it is committed (NFR-007);
 * commits go through the live config mutator (AC-03: the same config the
 * capture pipeline reads, so feed + pipeline update live).
 *
 * Pose editing: position XYZ + look-target XYZ (derived from the pose
 * quaternion; edited targets re-aim via lookAtQuaternion).
 * Focus: focal mm is editable, vFOV is the derived readout (one of the
 * two is always derived — the physical pinhole model is the source).
 */

import { useState } from 'react';
import {
  lookAtPoint,
  lookTargetMm,
  vFovDeg,
} from './labReport';
import {
  parcelCentreWorldMm,
} from '../../observation/projection';
import {
  validateCameraRigs,
  type Quat,
} from '../../domain/camera';
import type { SimConfig } from '../../domain/config';
import type {
  CameraConfig,
  CameraState,
  ParcelState,
} from '../../domain/types';

interface LabControlsProps {
  config: SimConfig;
  states: Record<string, CameraState>;
  parcels: ParcelState[];
  selectedCameraId: string | null;
  onSelectCamera: (id: string) => void;
  selectedParcelId: string | null;
  onSelectParcel: (id: string | null) => void;
  frozen: boolean;
  onToggleFreeze: () => void;
  onStep: () => void;
  /** Commit a validated config edit (AC-03 live propagation). */
  onCommit: (mutator: (cfg: SimConfig) => SimConfig) => void;
  /** Fault raise/clear (CAM-009 state machine, not a config field). */
  onFault: (id: string, faulted: boolean) => void;
}

function Field({
  label,
  value,
  onValue,
  step,
}: {
  label: string;
  value: number;
  onValue: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="cam-field">
      <span>{label}</span>
      <input
        type="number"
        step={step ?? 1}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onValue(n);
        }}
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="lab-section">
      <div className="cam-section">{title}</div>
      <div className="cam-grid">{children}</div>
    </div>
  );
}

export function LabControls({
  config,
  states,
  parcels,
  selectedCameraId,
  onSelectCamera,
  selectedParcelId,
  onSelectParcel,
  frozen,
  onToggleFreeze,
  onStep,
  onCommit,
  onFault,
}: LabControlsProps) {
  const [error, setError] = useState<string | null>(null);
  const rigs = config.cameraRigs;
  const rig = rigs.find((r) => r.id === selectedCameraId) ?? null;
  const parcel = parcels.find((p) => p.parcelId === selectedParcelId) ?? null;

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

  const patch = (fn: (r: CameraConfig) => CameraConfig) => {
    if (!rig) return;
    applyRigs(rigs.map((r) => (r.id === rig.id ? fn(r) : r)));
  };

  /** Look target at the (stable) slant distance to the selected parcel. */
  const targetDist = parcel
    ? Math.hypot(
        ...(lookTargetMm(rig!, 1000).map(
          (v, i) => v - (parcelCentreWorldMm(parcel)[i] ?? 0),
        ) as [number, number, number]),
      )
    : 1000;
  const target: [number, number, number] = rig
    ? lookTargetMm(rig, targetDist)
    : [0, 0, 0];

  return (
    <div className="lab-controls" data-testid="lab-controls">
      <div className="lab-row">
        <label className="cam-field">
          <span>Camera</span>
          <select
            data-testid="lab-camera-select"
            value={selectedCameraId ?? ''}
            onChange={(e) => onSelectCamera(e.target.value)}
          >
            {rigs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} — {r.role} ({states[r.id] ?? 'OFFLINE'})
              </option>
            ))}
          </select>
        </label>
        <label className="cam-field">
          <span>Parcel</span>
          <select
            data-testid="lab-parcel-select"
            value={selectedParcelId ?? ''}
            onChange={(e) => onSelectParcel(e.target.value || null)}
          >
            <option value="">— none —</option>
            {parcels.map((p) => (
              <option key={p.parcelId} value={p.parcelId}>
                {p.parcelId}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="lab-freeze"
          className={frozen ? 'lab-frozen' : ''}
          onClick={onToggleFreeze}
        >
          {frozen ? 'Resume' : 'Freeze'}
        </button>
        <button type="button" data-testid="lab-step" onClick={onStep} disabled={!frozen}>
          Step 50 ms
        </button>
      </div>

      {rig && (
        <div className="cam-detail" data-testid="lab-edit">
          <h3>
            {rig.id} — {rig.role} <span className="cam-state">{states[rig.id] ?? 'OFFLINE'}</span>
          </h3>

          <label className="cam-field">
            <span>Name</span>
            <input
              type="text"
              value={rig.name}
              onChange={(e) => patch((r) => ({ ...r, name: e.target.value }))}
            />
          </label>

          <Section title="Position (mm)">
            {(['x', 'y', 'z'] as const).map((axis, i) => (
              <Field
                key={axis}
                label={axis.toUpperCase()}
                value={rig.pose.positionMm[i]}
                onValue={(n) =>
                  patch((r) => {
                    const p = [...r.pose.positionMm] as [number, number, number];
                    p[i] = n;
                    return { ...r, pose: { ...r.pose, positionMm: p } };
                  })
                }
              />
            ))}
          </Section>

          <Section title={`Look target (mm, at ${Math.round(targetDist)} mm)`}>
            {(['x', 'y', 'z'] as const).map((axis, i) => (
              <Field
                key={axis}
                label={axis.toUpperCase()}
                value={target[i]}
                onValue={(n) => {
                  const t = [...target] as [number, number, number];
                  t[i] = n;
                  patch((r) => ({
                    ...r,
                    pose: {
                      positionMm: r.pose.positionMm,
                      quaternion: lookAtPoint(r, t).quaternion as Quat,
                    },
                  }));
                }}
              />
            ))}
          </Section>

          {parcel && (
            <button
              type="button"
              data-testid="lab-aim"
              onClick={() =>
                patch((r) => ({
                  ...r,
                  pose: {
                    positionMm: r.pose.positionMm,
                    quaternion: lookAtPoint(r, parcelCentreWorldMm(parcel)).quaternion as Quat,
                  },
                }))
              }
            >
              Aim at parcel
            </button>
          )}

          <Section title="Sensor (focal is editable — vFOV is derived)">
            <Field
              label="Width px"
              value={rig.sensor.widthPx}
              onValue={(n) =>
                patch((r) => ({ ...r, sensor: { ...r.sensor, widthPx: n } }))
              }
            />
            <Field
              label="Height px"
              value={rig.sensor.heightPx}
              onValue={(n) =>
                patch((r) => ({ ...r, sensor: { ...r.sensor, heightPx: n } }))
              }
            />
            <Field
              label="Focal mm"
              value={rig.sensor.focalLengthMm}
              step={0.5}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  sensor: { ...r.sensor, focalLengthMm: n },
                }))
              }
            />
            <Field
              label="vFOV deg (derived)"
              value={Math.round(vFovDeg(rig) * 100) / 100}
              onValue={() => undefined}
            />
            <Field
              label="Film gauge mm"
              value={rig.sensor.filmGaugeMm}
              step={0.5}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  sensor: { ...r.sensor, filmGaugeMm: n },
                }))
              }
            />
            <Field
              label="Near mm"
              value={rig.sensor.nearMm}
              onValue={(n) =>
                patch((r) => ({ ...r, sensor: { ...r.sensor, nearMm: n } }))
              }
            />
            <Field
              label="Far mm"
              value={rig.sensor.farMm}
              step={10}
              onValue={(n) =>
                patch((r) => ({ ...r, sensor: { ...r.sensor, farMm: n } }))
              }
            />
          </Section>

          {rig.sensor.roi && (
            <button
              type="button"
              data-testid="lab-roi-clear"
              onClick={() => patch((r) => ({ ...r, sensor: { ...r.sensor, roi: undefined } }))}
            >
              Clear ROI
            </button>
          )}

          <Section title="Acquisition">
            <Field
              label="FPS"
              value={rig.acquisition.fps}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  acquisition: { ...r.acquisition, fps: n },
                }))
              }
            />
            <Field
              label="Exposure µs"
              value={rig.acquisition.exposureUs}
              step={100}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  acquisition: { ...r.acquisition, exposureUs: n },
                }))
              }
            />
            <Field
              label="Gain dB"
              value={rig.acquisition.gainDb}
              step={1}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  acquisition: { ...r.acquisition, gainDb: n },
                }))
              }
            />
            <Field
              label="Focus distance mm"
              value={rig.acquisition.focusDistanceMm}
              step={10}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  acquisition: { ...r.acquisition, focusDistanceMm: n },
                }))
              }
            />
            <label className="cam-field">
              <span>Shutter</span>
              <select
                value={rig.acquisition.shutter}
                onChange={(e) =>
                  patch((r) => ({
                    ...r,
                    acquisition: {
                      ...r.acquisition,
                      shutter: e.target.value as 'GLOBAL' | 'ROLLING',
                    },
                  }))
                }
              >
                <option value="GLOBAL">GLOBAL</option>
                <option value="ROLLING">ROLLING</option>
              </select>
            </label>
          </Section>

          <Section title="Illumination">
            <Field
              label="Intensity"
              value={rig.illumination.intensity}
              step={0.1}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  illumination: { ...r.illumination, intensity: n },
                }))
              }
            />
            <Field
              label="Strobe µs"
              value={rig.illumination.strobeUs}
              step={10}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  illumination: { ...r.illumination, strobeUs: n },
                }))
              }
            />
            <Field
              label="Ambient leak"
              value={rig.illumination.ambientLeak}
              step={0.05}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  illumination: { ...r.illumination, ambientLeak: n },
                }))
              }
            />
            <label className="cam-field cam-check">
              <input
                type="checkbox"
                checked={rig.illumination.polarized}
                onChange={(e) =>
                  patch((r) => ({
                    ...r,
                    illumination: {
                      ...r.illumination,
                      polarized: e.target.checked,
                    },
                  }))
                }
              />
              <span>Polarized (glare suppression)</span>
            </label>
          </Section>

          <Section title="Noise / effects">
            <Field
              label="Shot noise"
              value={rig.imageEffects.shotNoise}
              step={0.05}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  imageEffects: { ...r.imageEffects, shotNoise: n },
                }))
              }
            />
            <Field
              label="Read noise"
              value={rig.imageEffects.readNoise}
              step={0.05}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  imageEffects: { ...r.imageEffects, readNoise: n },
                }))
              }
            />
            <Field
              label="Compression"
              value={rig.imageEffects.compression}
              step={0.05}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  imageEffects: { ...r.imageEffects, compression: n },
                }))
              }
            />
            <Field
              label="Aperture proxy (glare/CoC)"
              value={rig.optics.apertureProxy}
              step={0.5}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  optics: { ...r.optics, apertureProxy: n },
                }))
              }
            />
          </Section>

          <Section title="Preview">
            <Field
              label="Width px"
              value={rig.preview.widthPx}
              step={16}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  preview: { ...r.preview, widthPx: n },
                }))
              }
            />
            <Field
              label="Height px"
              value={rig.preview.heightPx}
              step={16}
              onValue={(n) =>
                patch((r) => ({
                  ...r,
                  preview: { ...r.preview, heightPx: n },
                }))
              }
            />
            <label className="cam-field cam-check">
              <input
                type="checkbox"
                checked={rig.preview.overlay}
                onChange={(e) =>
                  patch((r) => ({
                    ...r,
                    preview: { ...r.preview, overlay: e.target.checked },
                  }))
                }
              />
              <span>Preview overlay</span>
            </label>
          </Section>

          <label className="cam-field cam-check">
            <input
              type="checkbox"
              data-testid="lab-fault"
              checked={states[rig.id] === 'FAULT'}
              onChange={(e) => onFault(rig.id, e.target.checked)}
            />
            <span>Camera fault (CAM-009)</span>
          </label>
        </div>
      )}

      {error && (
        <div className="cam-error" data-testid="lab-edit-error">
          {error}
        </div>
      )}
    </div>
  );
}

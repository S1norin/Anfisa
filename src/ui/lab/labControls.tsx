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
import {
  FAULT_SCENARIOS,
  PRESETS,
} from '../../presets';
import type {
  AreaScanCameraConfig,
  CameraConfig,
  CameraState,
  LineScanCameraConfig,
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
  /** Apply a named preset: resets the run with the preset config (CFG-004). */
  onApplyPreset: (id: string) => void;
  /** Apply a live fault scenario (no reset). */
  onFaultScenario: (id: string) => void;
  /** Download the current config as a versioned JSON file (CFG-007). */
  onExportConfig: () => void;
  /** Import config JSON text; returns validation errors on failure. */
  onImportConfig: (text: string) => string[];
  /** Download the full run record (AC-10). */
  onExportRun: () => void;
  /** Download the observation audit log (AC-10). */
  onExportObservations: () => void;
  /** Download the metrics CSV (AC-10). */
  onExportMetricsCsv: () => void;
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

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <label className="cam-field cam-readout">
      <span>{label}</span>
      <span data-testid={label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}>{value}</span>
    </label>
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
  onApplyPreset,
  onFaultScenario,
  onExportConfig,
  onImportConfig,
  onExportRun,
  onExportObservations,
  onExportMetricsCsv,
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

  /** Area-rig-only patches (sensor/acquisition/optics/illumination/effect params). */
  const patchArea = (fn: (r: AreaScanCameraConfig) => AreaScanCameraConfig) => {
    if (!rig || rig.kind !== 'AREA_SCAN') return;
    applyRigs(
      rigs.map((r) => (r.id === rig.id ? (fn(r as AreaScanCameraConfig) as CameraConfig) : r)),
    );
  };

  /** Line-rig-only patches (line sensor + encoder sync). */
  const patchLine = (fn: (r: LineScanCameraConfig) => LineScanCameraConfig) => {
    if (!rig || rig.kind !== 'LINE_SCAN') return;
    applyRigs(
      rigs.map((r) => (r.id === rig.id ? (fn(r as LineScanCameraConfig) as CameraConfig) : r)),
    );
  };

  /** Derived line-scan readouts (mm/s line rate, mm/line pitch, …). */
  const line = rig?.kind === 'LINE_SCAN' ? rig.line : null;
  const linePitchMm = line ? line.sensorWidthMm / line.pixelsPerLine : 0;
  // The scan plane sits at deck level (y = 0); for the TOP/BOTTOM presets
  // the rig's y offset is exactly the working distance.
  const workingDistanceMm = rig && line ? Math.abs(rig.pose.positionMm[1]) : 0;
  const requiredLineRate = line ? config.belt.speedMmPerSec / line.encoderStepMmPerLine : 0;
  const rateMargin = line && requiredLineRate > 0 ? line.maxLineRateLinesPerSec / requiredLineRate : 0;
  const linesAcrossLabel = linePitchMm > 0 ? 25 / linePitchMm : 0;

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

      <div className="lab-row" data-testid="lab-preset-row">
        <label className="cam-field">
          <span>Preset (resets run)</span>
          <select
            data-testid="lab-preset"
            value=""
            onChange={(e) => {
              if (e.target.value) onApplyPreset(e.target.value);
            }}
          >
            <option value="">— apply —</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="lab-faults">
          {FAULT_SCENARIOS.map((f) => (
            <button
              key={f.id}
              type="button"
              data-testid={`lab-fault-${f.id}`}
              title={f.description}
              onClick={() => onFaultScenario(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      <div className="lab-row" data-testid="lab-export-row">
        <span className="lab-export-title">Export / Import</span>
        <div className="lab-faults">
          <button
            type="button"
            data-testid="lab-export-config"
            onClick={onExportConfig}
          >
            Config JSON
          </button>
          <label className="lab-import-label">
            Import config…
            <input
              data-testid="lab-import-config"
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void file
                  .text()
                  .then((text) => {
                    const errors = onImportConfig(text);
                    if (errors.length > 0) {
                      setError(`import rejected: ${errors[0]}`);
                    } else {
                      setError(null);
                    }
                  });
              }}
            />
          </label>
          <button
            type="button"
            data-testid="lab-export-run"
            onClick={onExportRun}
          >
            Run JSON
          </button>
          <button
            type="button"
            data-testid="lab-export-observations"
            onClick={onExportObservations}
          >
            Observations JSON
          </button>
          <button
            type="button"
            data-testid="lab-export-metrics-csv"
            onClick={onExportMetricsCsv}
          >
            Metrics CSV
          </button>
        </div>
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

          {rig.kind === 'AREA_SCAN' ? (
            <>
          <Section title="Sensor (focal is editable — vFOV is derived)">
            <Field
              label="Width px"
              value={rig.sensor.widthPx}
              onValue={(n) =>
                patchArea((r) => ({ ...r, sensor: { ...r.sensor, widthPx: n } }))
              }
            />
            <Field
              label="Height px"
              value={rig.sensor.heightPx}
              onValue={(n) =>
                patchArea((r) => ({ ...r, sensor: { ...r.sensor, heightPx: n } }))
              }
            />
            <Field
              label="Focal mm"
              value={rig.sensor.focalLengthMm}
              step={0.5}
              onValue={(n) =>
                patchArea((r) => ({
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
                patchArea((r) => ({
                  ...r,
                  sensor: { ...r.sensor, filmGaugeMm: n },
                }))
              }
            />
            <Field
              label="Near mm"
              value={rig.sensor.nearMm}
              onValue={(n) =>
                patchArea((r) => ({ ...r, sensor: { ...r.sensor, nearMm: n } }))
              }
            />
            <Field
              label="Far mm"
              value={rig.sensor.farMm}
              step={10}
              onValue={(n) =>
                patchArea((r) => ({ ...r, sensor: { ...r.sensor, farMm: n } }))
              }
            />
          </Section>

          {rig.sensor.roi && (
            <button
              type="button"
              data-testid="lab-roi-clear"
              onClick={() => patchArea((r) => ({ ...r, sensor: { ...r.sensor, roi: undefined } }))}
            >
              Clear ROI
            </button>
          )}

          <Section title="Acquisition">
            <Field
              label="FPS"
              value={rig.acquisition.fps}
              onValue={(n) =>
                patchArea((r) => ({
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
                patchArea((r) => ({
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
                patchArea((r) => ({
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
                patchArea((r) => ({
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
                  patchArea((r) => ({
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
                patchArea((r) => ({
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
                patchArea((r) => ({
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
                patchArea((r) => ({
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
                  patchArea((r) => ({
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
                patchArea((r) => ({
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
                patchArea((r) => ({
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
                patchArea((r) => ({
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
                patchArea((r) => ({
                  ...r,
                  optics: { ...r.optics, apertureProxy: n },
                }))
              }
            />
          </Section>
            </>
          ) : (
            <div data-testid="lab-line-fields">
              <Section title="Line sensor">
                <Field
                  label="Sensor width mm"
                  value={rig.line.sensorWidthMm}
                  step={16}
                  onValue={(n) =>
                    patchLine((r) => ({
                      ...r,
                      line: { ...r.line, sensorWidthMm: n },
                    }))
                  }
                />
                <Field
                  label="Pixels/line"
                  value={rig.line.pixelsPerLine}
                  step={256}
                  onValue={(n) =>
                    patchLine((r) => ({
                      ...r,
                      line: { ...r.line, pixelsPerLine: n },
                    }))
                  }
                />
                <Readout label="Line pitch mm" value={linePitchMm.toFixed(4)} />
                <Readout
                  label="Working distance mm"
                  value={Math.round(workingDistanceMm).toString()}
                />
              </Section>

              <Section title="Encoder sync">
                <Field
                  label="Encoder step mm/line"
                  value={rig.line.encoderStepMmPerLine}
                  step={0.01}
                  onValue={(n) =>
                    patchLine((r) => ({
                      ...r,
                      line: { ...r.line, encoderStepMmPerLine: n },
                    }))
                  }
                />
                <Field
                  label="Max line rate (lines/s)"
                  value={rig.line.maxLineRateLinesPerSec}
                  step={1000}
                  onValue={(n) =>
                    patchLine((r) => ({
                      ...r,
                      line: { ...r.line, maxLineRateLinesPerSec: n },
                    }))
                  }
                />
                <Field
                  label="Scan plane Z mm"
                  value={rig.line.scanPlaneZMm}
                  step={10}
                  onValue={(n) =>
                    patchLine((r) => ({
                      ...r,
                      line: { ...r.line, scanPlaneZMm: n },
                    }))
                  }
                />
                <Readout
                  label="Required line rate (lines/s)"
                  value={Math.round(requiredLineRate).toString()}
                />
                <Readout
                  label="Line-rate margin ×"
                  value={rateMargin > 0 ? rateMargin.toFixed(2) : '—'}
                />
                <Readout
                  label="Lines across 25 mm label"
                  value={Math.round(linesAcrossLabel).toString()}
                />
              </Section>

              <Readout
                label="Travel / scan axes"
                value="belt +Z · sensor across belt width (X)"
              />
            </div>
          )}

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

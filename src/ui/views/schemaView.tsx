/**
 * Schema view (issue #13): a separate, low-clutter, dimensioned schematic
 * of the station.
 *
 * - Orthographic TOP/SIDE/FRONT presets + free ISO perspective (t13-1).
 * - Dimension lines, frusta/axes/ROIs, focus planes, named scan zones,
 *   incidence + yaw angle arcs, and per-label annotations (t13-2/t13-3),
 *   each behind its own toggle group.
 * - Freeze / step-one-frame / fit / PNG export (t13-4, AC-09).
 *
 * The 3D content lives in scene/schemaScene.tsx (pure geometry from
 * scene/schemaData.ts); this component only wires controls to the sim store
 * and the scene API.
 */

import { useEffect, useRef, useState } from 'react';
import { simStore, useSim } from '../../store/simStore';
import {
  DEFAULT_SCHEMA_TOGGLES,
  SchemaScene,
  type SchemaSceneApi,
  type SchemaToggles,
} from '../../scene/schemaScene';
import { schemaPresets, type SchemaPreset } from '../../scene/schemaPresets';

const PRESET_ORDER: SchemaPreset['name'][] = ['TOP', 'SIDE', 'FRONT', 'ISO'];

const TOGGLE_GROUPS: { key: keyof SchemaToggles; label: string }[] = [
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'frusta', label: 'Camera frusta' },
  { key: 'axes', label: 'Optical axes' },
  { key: 'roi', label: 'Sensor ROI' },
  { key: 'focusPlanes', label: 'Focus planes' },
  { key: 'scanZones', label: 'Scan zones' },
  { key: 'arcs', label: 'Angle arcs' },
  { key: 'labels', label: 'Label annotations' },
];

const DISPLAY_PRESETS: { label: string; toggles: SchemaToggles }[] = [
  { label: 'Overview', toggles: DEFAULT_SCHEMA_TOGGLES },
  {
    label: 'Cameras',
    toggles: {
      dimensions: false,
      frusta: true,
      scanZones: false,
      focusPlanes: false,
      axes: true,
      roi: false,
      arcs: false,
      labels: false,
    },
  },
  {
    label: 'Inspect',
    toggles: {
      dimensions: true,
      frusta: false,
      scanZones: false,
      focusPlanes: false,
      axes: false,
      roi: false,
      arcs: true,
      labels: true,
    },
  },
];

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SchemaView() {
  const sim = useSim();
  const { config, parcels, cameraStates, status } = sim.state;

  const [presetName, setPresetName] = useState<SchemaPreset['name']>('TOP');
  const [toggles, setToggles] = useState<SchemaToggles>(DEFAULT_SCHEMA_TOGGLES);
  const [api, setApi] = useState<SchemaSceneApi | null>(null);
  const [exportedMs, setExportedMs] = useState<number | null>(null);
  const apiRef = useRef<SchemaSceneApi | null>(null);

  useEffect(() => {
    return () => {
      apiRef.current = null;
    };
  }, []);

  const liveParcels = [...parcels.values()];
  const parcel = liveParcels.length > 0 ? liveParcels[liveParcels.length - 1] : null;

  const presetNames = Object.keys(schemaPresets(config.station.lengthMm)) as SchemaPreset['name'][];

  const toggle = (key: keyof SchemaToggles) => setToggles((t) => ({ ...t, [key]: !t[key] }));

  const presetIsActive = (preset: SchemaToggles) =>
    (Object.keys(preset) as (keyof SchemaToggles)[]).every((key) => toggles[key] === preset[key]);

  const onExport = async () => {
    const blob = (await api?.exportPng()) ?? null;
    if (blob) {
      downloadBlob(blob, `schema-${presetName.toLowerCase()}-${sim.state.simTimeMs}ms.png`);
      setExportedMs(sim.state.simTimeMs);
    }
  };

  return (
    <section className="view view-schema" data-testid="schema-view">
      <div className="view-canvas-col">
        <div className="schema-toolbar">
          <div className="schema-toolbar-group" role="group" aria-label="View presets">
            {PRESET_ORDER.filter((n) => presetNames.includes(n)).map((name) => (
              <button
                key={name}
                type="button"
                data-testid={`schema-preset-${name.toLowerCase()}`}
                className={name === presetName ? 'active' : ''}
                onClick={() => setPresetName(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="schema-toolbar-group" role="group" aria-label="Time controls">
            <button
              type="button"
              data-testid="schema-freeze"
              onClick={() => (status === 'RUNNING' ? simStore.pause() : simStore.start())}
            >
              {status === 'RUNNING' ? 'Freeze' : 'Resume'}
            </button>
            <button
              type="button"
              data-testid="schema-step"
              disabled={status !== 'PAUSED'}
              onClick={() => simStore.stepOnce()}
            >
              Step 1
            </button>
          </div>
          <div className="schema-toolbar-group" role="group" aria-label="Camera tools">
            <button type="button" data-testid="schema-fit" onClick={() => apiRef.current?.fit()}>
              Fit
            </button>
            <button
              type="button"
              data-testid="schema-export"
              disabled={api === null}
              onClick={onExport}
            >
              PNG
            </button>
          </div>
          <span className="schema-time" data-testid="schema-time">
            t = {(sim.state.simTimeMs / 1000).toFixed(2)} s · {status}
          </span>
        </div>
        <div className="view-canvas schema-canvas">
          <SchemaScene
            config={config}
            parcel={parcel}
            presetName={presetName}
            toggles={toggles}
            cameraStates={cameraStates}
            onApi={(a) => {
              apiRef.current = a;
              setApi(a);
            }}
          />
        </div>
      </div>
      <div className="view-panel schema-panel">
        <h2>Schema</h2>
        <p className="schema-hint">
          Low-clutter schematic: dimensions, geometry, and readability context for the{' '}
          <strong>{presetName}</strong> view.
        </p>
        <div className="op-card">
          <h3>Display</h3>
          <div className="schema-display-presets" role="group" aria-label="Display presets">
            {DISPLAY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                data-testid={`schema-display-${preset.label.toLowerCase()}`}
                className={presetIsActive(preset.toggles) ? 'active' : ''}
                onClick={() => setToggles({ ...preset.toggles })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <details className="schema-layers">
            <summary>Layers</summary>
            <div className="schema-toggles" data-testid="schema-toggles">
              {TOGGLE_GROUPS.map(({ key, label }) => (
                <label key={key} className="schema-toggle">
                  <input
                    type="checkbox"
                    data-testid={`schema-toggle-${key}`}
                    checked={toggles[key]}
                    onChange={() => toggle(key)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>
        </div>
        <div className="op-card">
          <h3>Parcel</h3>
          {parcel ? (
            <div className="schema-parcel" data-testid="schema-parcel">
              <div className="op-card-id">{parcel.parcelId}</div>
              <div>{parcel.spec.labels.length} labels</div>
              <div>
                {Math.round(parcel.spec.widthMm)} × {Math.round(parcel.spec.heightMm)} ×{' '}
                {Math.round(parcel.spec.lengthMm)} mm · yaw {Math.round(parcel.spec.yawDeg)}°
              </div>
            </div>
          ) : (
            <p className="op-card-empty">No live parcel — start the simulation.</p>
          )}
        </div>
        {exportedMs !== null && (
          <p className="schema-export-note" data-testid="schema-export-note">
            Exported PNG at t = {(exportedMs / 1000).toFixed(2)} s.
          </p>
        )}
      </div>
    </section>
  );
}

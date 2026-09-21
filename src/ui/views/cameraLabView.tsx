/**
 * Camera Lab (issue #12): select one camera + one parcel, freeze time,
 * edit the full rig (pose, optics, acquisition, illumination, noise,
 * preview, fault) and read the physical FOV at the target plane,
 * distance, incidence angle, projected PPM, estimated blur, coverage
 * and the current readability reasons — from the pipeline's own
 * observation engine. Edits commit to the LIVE config (AC-03), so the
 * feed and pipeline reflect them immediately.
 */

import { useState } from 'react';
import { simStore, useSim } from '../../store/simStore';
import { importConfigIntoStore } from '../../store/import';
import { downloadTextFile } from '../../export/download';
import {
  buildLiveRunRecord,
  configToJson,
  observationsToJson,
  runRecordToJson,
} from '../../export/json';
import { metricsToCsv } from '../../export/csv';
import { SceneCanvas } from '../../scene/sceneCanvas';
import { applyPresetToStore, getFaultScenario } from '../../presets';
import { computeLabReport } from '../lab/labReport';
import { LabControls } from '../lab/labControls';
import { LabReportView } from '../lab/labReportView';
import { DecoderComparison } from '../lab/decoderComparison';

export function CameraLabView() {
  const sim = useSim();
  const state = sim.state;
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(
    state.config.cameraRigs[0]?.id ?? null,
  );
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const frozen = state.status !== 'RUNNING';

  // The store mutates this Map in place, so spread it on every store-driven
  // render rather than memoizing by its stable identity.
  const parcels = [...state.parcels.values()];

  /** Default: the newest parcel (highest frontZMm); stale selections fall back. */
  const parcel = parcels.find((p) => p.parcelId === selectedParcelId) ?? parcels[0] ?? null;
  const rig =
    state.config.cameraRigs.find((r) => r.id === selectedCameraId) ??
    state.config.cameraRigs[0] ??
    null;

  const report =
    rig && parcel && rig.kind === 'AREA_SCAN'
      ? computeLabReport(
          rig,
          state.cameraStates[rig.id] ?? 'OFFLINE',
          parcel,
          parcels,
          state.simTimeMs,
          state.speedMmPerSec,
          state.config,
        )
      : null;

  return (
    <div className="view view-camera-lab" data-testid="camera-lab-view">
      <h2>Camera Lab</h2>
      <div className="lab-layout">
        <div className="view-canvas-col">
          <div className="view-canvas">
            <SceneCanvas
              config={state.config}
              cameraStates={state.cameraStates}
              selectedCameraId={rig?.id ?? null}
              onSelectCamera={setSelectedCameraId}
              parcels={parcels}
              selectedParcelId={parcel?.parcelId ?? null}
              onSelectParcel={setSelectedParcelId}
              cameraView
            />
            {rig && rig.kind === 'AREA_SCAN' && (
              <div className="camera-view-hud" aria-label="Active camera view">
                <span className="camera-view-live">CAMERA VIEW</span>
                <strong>{rig.name}</strong>
                <span>
                  {rig.sensor.widthPx} × {rig.sensor.heightPx} · {rig.sensor.focalLengthMm} mm
                </span>
              </div>
            )}
            <div className="camera-view-reticle" aria-hidden="true" />
          </div>
          <div className="view-panel">
            <LabReportView report={report} hasParcel={parcel !== null} />
            {/* On-demand pixel experiment (issue #17, t4-zxing): custom
                TS decoder and ZXing C++ (wasm, lazy-loaded). */}
            {report && parcel && (
              <DecoderComparison
                report={report}
                parcel={parcel}
                cameraId={rig?.id ?? null}
                simTimeMs={state.simTimeMs}
                frozen={frozen}
                onExperiment={() => simStore.notePixelExperiment(state.simTimeMs)}
              />
            )}
          </div>
        </div>
        <div className="view-side">
          <LabControls
            config={state.config}
            states={state.cameraStates}
            parcels={parcels}
            selectedCameraId={rig?.id ?? null}
            onSelectCamera={setSelectedCameraId}
            selectedParcelId={parcel?.parcelId ?? null}
            onSelectParcel={setSelectedParcelId}
            frozen={frozen}
            onToggleFreeze={() => (frozen ? simStore.start() : simStore.pause())}
            onStep={() => simStore.stepOnce()}
            onCommit={(mutator) => simStore.updateConfig(mutator)}
            onFault={(id, faulted) => simStore.setCameraFault(id, faulted)}
            onApplyPreset={(id) => {
              // Reset clears the run; clear the parcel selection too.
              setSelectedParcelId(null);
              applyPresetToStore(simStore, id);
            }}
            onFaultScenario={(id) => getFaultScenario(id)?.apply(simStore)}
            onExportConfig={() =>
              downloadTextFile(
                `anfisa-config-${state.runId}.json`,
                configToJson(state.config),
                'application/json',
              )
            }
            onImportConfig={(text) => {
              const outcome = importConfigIntoStore(simStore, text);
              return outcome.ok ? [] : outcome.errors;
            }}
            onExportRun={() =>
              downloadTextFile(
                `anfisa-run-${state.runId}.json`,
                runRecordToJson(buildLiveRunRecord(simStore, simStore.computeLiveMetrics())),
                'application/json',
              )
            }
            onExportObservations={() =>
              downloadTextFile(
                `anfisa-observations-${state.runId}.json`,
                observationsToJson(state.runId, state.config.seed, simStore.liveObservations),
                'application/json',
              )
            }
            onExportMetricsCsv={() =>
              downloadTextFile(
                `anfisa-metrics-${state.runId}.csv`,
                metricsToCsv(
                  simStore.computeLiveMetrics(),
                  simStore.liveObservations,
                ),
                'text/csv',
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

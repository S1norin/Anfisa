/**
 * Camera Lab (issue #12): select one camera + one parcel, freeze time,
 * edit the full rig (pose, optics, acquisition, illumination, noise,
 * preview, fault) and read the physical FOV at the target plane,
 * distance, incidence angle, projected PPM, estimated blur, coverage
 * and the current readability reasons — from the pipeline's own
 * observation engine. Edits commit to the LIVE config (AC-03), so the
 * feed and pipeline reflect them immediately.
 */

import { useMemo, useState } from 'react';
import { simStore, useSim } from '../../store/simStore';
import { SceneCanvas } from '../../scene/sceneCanvas';
import { computeLabReport } from '../lab/labReport';
import { LabControls } from '../lab/labControls';
import { LabReportView } from '../lab/labReportView';

export function CameraLabView() {
  const sim = useSim();
  const state = sim.state;
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(
    state.config.cameraRigs[0]?.id ?? null,
  );
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const frozen = state.status !== 'RUNNING';

  // The parcels Map is mutated in place (spawn/despawn), so its identity is
  // stable — re-spread on the tick instead of depending on the Map ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Map identity is stable; see note
  const parcels = useMemo(() => [...state.parcels.values()], [
    state.simTimeMs,
    state.config,
    state.cameraStates,
  ]);

  /** Default: the newest parcel (highest frontZMm); stale selections fall back. */
  const parcel =
    parcels.find((p) => p.parcelId === selectedParcelId) ??
    parcels[0] ??
    null;
  const rig =
    state.config.cameraRigs.find((r) => r.id === selectedCameraId) ??
    state.config.cameraRigs[0] ??
    null;

  const report = useMemo(
    () =>
      rig && parcel
        ? computeLabReport(
            rig,
            state.cameraStates[rig.id] ?? 'OFFLINE',
            parcel,
            parcels,
            state.simTimeMs,
            state.speedMmPerSec,
            state.config,
          )
        : null,
    // simTimeMs + rigs are the deterministic inputs while frozen; the sim
    // version bump (useSim re-render) re-evaluates on resume/step/commit.
    [rig, parcel, state.simTimeMs, state.speedMmPerSec, state.config, state.cameraStates, parcels],
  );

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
            />
          </div>
          <div className="view-panel">
            <LabReportView report={report} hasParcel={parcel !== null} />
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
            onStep={() => simStore.step(10)}
            onCommit={(mutator) => simStore.updateConfig(mutator)}
            onFault={(id, faulted) => simStore.setCameraFault(id, faulted)}
          />
        </div>
      </div>
    </div>
  );
}

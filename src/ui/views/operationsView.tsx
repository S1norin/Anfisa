import { useState } from 'react';
import { SceneCanvas } from '../../scene/sceneCanvas';
import { simStore, useSim } from '../../store/simStore';
import { CameraEditor } from '../cameraEditor';

export function OperationsView() {
  const sim = useSim();
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const { config, cameraStates } = sim.state;

  return (
    <section className="view view-operations" data-testid="operations-view">
      <div className="view-canvas">
        <SceneCanvas
          config={config}
          cameraStates={cameraStates}
          selectedCameraId={selectedCameraId}
          onSelectCamera={setSelectedCameraId}
        />
      </div>
      <div className="view-panel">
        <h2>Operations</h2>
        <CameraEditor
          config={config}
          states={cameraStates}
          selectedId={selectedCameraId}
          onSelect={setSelectedCameraId}
          onCommit={(mutator) => simStore.updateConfig(mutator)}
        />
        <p>
          Live conveyor parcels and labels land in issue #11.
        </p>
      </div>
    </section>
  );
}

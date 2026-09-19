import { SceneCanvas } from '../../scene/sceneCanvas';

export function OperationsView() {
  return (
    <section className="view" data-testid="operations-view">
      <div className="view-canvas">
        <SceneCanvas />
      </div>
      <div className="view-panel">
        <h2>Operations</h2>
        <p>
          Live conveyor cell: parcels, labels, camera status, selection, and
          dimension overlays land in issue #11.
        </p>
      </div>
    </section>
  );
}

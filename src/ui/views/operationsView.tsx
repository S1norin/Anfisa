import { SceneCanvas } from '../../scene/sceneCanvas';

/**
 * Operations view (issue #11 will build the full presentation view).
 * For the scaffold: the 3D station canvas placeholder + empty panels.
 */
export function OperationsView() {
  return (
    <div className="view view-operations" data-testid="operations-view">
      <section className="view-canvas" aria-label="3D station">
        <SceneCanvas />
      </section>
      <aside className="view-side">
        <h2>Operations</h2>
        <p data-testid="operations-placeholder">
          Station view. Camera wall, parcel timeline, result card, and live
          metrics land here in issue #11.
        </p>
      </aside>
    </div>
  );
}

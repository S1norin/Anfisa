/**
 * Metrics and run review (issues #10/#15/#16): run summary, per-camera table,
 * breakdowns, failure table, exports. Placeholder for the scaffold.
 */
export function MetricsView() {
  return (
    <div className="view view-metrics" data-testid="metrics-view">
      <h2>Metrics</h2>
      <p data-testid="metrics-placeholder">
        Run summary, breakdowns, and exports land here in issues #10/#15/#16.
      </p>
      <p data-testid="metrics-mode">
        Processing mode: run records and captures use <code>GEOMETRY_MODEL</code>;
        the on-demand pixel probe uses <code>PIXEL_DECODER</code> (not part of the
        capture path).
      </p>
    </div>
  );
}

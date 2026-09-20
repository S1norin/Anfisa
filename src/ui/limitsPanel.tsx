/**
 * In-app "Simulation limits" panel (NFR-012): makes the demo's scope explicit
 * at the point of presentation so synthetic results are never mistaken for
 * optical measurements. The same limitations are repeated in the README.
 */

export function LimitsPanel() {
  return (
    <details className="op-card limits-panel" data-testid="limits-panel">
      <summary>Simulation limits</summary>
      <ul>
        <li>
          All imagery and readings are synthetic ground truth — this demo has
          no real cameras, belt, or PLC.
        </li>
        <li>
          Decoding is geometric (label placement, camera geometry, quality
          gates), not real pixel-level barcode decoding.
        </li>
        <li>
          Run metrics are regression metrics of the measurement model; they
          are not optical performance numbers.
        </li>
        <li>
          Camera feeds are synthetic previews rendered from the same config
          that drives the pipeline.
        </li>
        <li>
          The run is deterministic: identical config + seed reproduces the
          same record at any refresh rate.
        </li>
        <li>
          Optical validation (real capture, real decode rates) still requires
          a physical PoC.
        </li>
      </ul>
    </details>
  );
}

/**
 * Geometry vs pixel decoder comparison (t17, issue #17, m5 stretch).
 *
 * Camera Lab panel: for the selected camera + parcel, run the synthetic
 * pixel decoder on the LAST CAPTURED FRAME (read on demand from the
 * capture FBO) and compare its verdicts with the geometry model's,
 * label by label. Explicitly labelled as a synthetic experiment — it
 * decodes the app's own rendered frames, never real optics (NFR-001:
 * off the capture/decode hot path).
 */

import { useState } from 'react';
import type { ParcelState } from '../../domain/types';
import {
  applySensorRoi,
  pixelDecodeFrame,
  type PixelDecodeResult,
  type PixelFrame,
  type SensorRoi,
} from '../../pipeline/pixelDecoder';
import type { LabReport } from './labReport';

interface PixelProbeHandle {
  renderFullResFrame: (cameraId: string) =>
    | { frame: PixelFrame; roi: SensorRoi | undefined }
    | null;
}

declare global {
  interface Window {
    __anfisaPixels?: PixelProbeHandle;
  }
}

export interface PixelExperimentOutcome {
  cameraId: string;
  parcelId: string;
  simTimeMs: number;
  frameWidthPx: number;
  frameHeightPx: number;
  candidateCount: number;
  /** One pixel decode result per candidate, in candidate order. */
  pixel: PixelDecodeResult[];
}

interface Props {
  report: LabReport | null;
  parcel: ParcelState | null;
  cameraId: string | null;
  simTimeMs: number;
  frozen: boolean;
  /** Stamp the run record with the PIXEL_DECODER mode (t17). */
  onExperiment: () => void;
}

export function DecoderComparison({
  report,
  parcel,
  cameraId,
  simTimeMs,
  frozen,
  onExperiment,
}: Props) {
  const [outcome, setOutcome] = useState<PixelExperimentOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const labels = report?.labels ?? [];
  const candidateIds = new Set(
    labels
      .filter((l) => l.projectedCornersPx.length === 4)
      .map((l) => l.labelInstanceId),
  );

  const run = () => {
    setError(null);
    if (!frozen) {
      setError('Freeze the sim first — the pixel decoder reads the last captured frame.');
      return;
    }
    if (!cameraId || !parcel) {
      setError('Select a camera and a parcel.');
      return;
    }
    const probe = window.__anfisaPixels;
    if (!probe) {
      setError('Pixel probe unavailable (3D canvas not mounted).');
      return;
    }
    const probed = probe.renderFullResFrame(cameraId);
    if (!probed) {
      setError('Frame render failed (unknown camera).');
      return;
    }
    const allCands = labels
      .filter((l) => l.projectedCornersPx.length === 4)
      .map((l) => ({
        labelInstanceId: l.labelInstanceId,
        quadPx: l.projectedCornersPx as [number, number][],
      }));
    if (allCands.length === 0) {
      setError('No in-frame label for this parcel from this camera (all labels out of FOV).');
      return;
    }
    // Explicit ROI/mask stage (t4-pixel): crop the frame to the rig's
    // sensor ROI before decoding; excluded labels surface as
    // PIXEL:OUT_OF_FRAME instead of silently missing.
    const { frame, candidates: cands } = applySensorRoi(probed.frame, probed.roi, allCands);
    setBusy(true);
    // Defer: let the button paint, then do the (GPU-syncing + decode) work.
    queueMicrotask(() => {
      const results = pixelDecodeFrame(frame, cands);
      onExperiment();
      setOutcome({
        cameraId,
        parcelId: parcel.parcelId,
        simTimeMs,
        frameWidthPx: frame.widthPx,
        frameHeightPx: frame.heightPx,
        candidateCount: cands.length,
        pixel: results,
      });
      setBusy(false);
    });
  };

  const truthFor = (labelInstanceId: string): string =>
    parcel?.spec.labels.find((l) => l.labelInstanceId === labelInstanceId)?.payload ?? '—';

  const pixelFor = (labelInstanceId: string): PixelDecodeResult | undefined =>
    outcome?.pixel.find((r) => r.labelInstanceId === labelInstanceId);

  return (
    <section className="decoder-comparison" data-testid="decoder-comparison">
      <h3>Geometry vs pixel decoder</h3>
      <p className="dc-banner" data-testid="dc-banner">
        Synthetic pixel experiment: renders the scene from this camera at
        full sensor resolution and decodes the bwip-js label textures from
        raw pixels. Not a real-optics validation; off the capture path.
      </p>
      <p className="dc-modes" data-testid="dc-modes">
        Geometry verdicts: <code>GEOMETRY_MODEL</code> · Pixel verdicts:{' '}
        <code>PIXEL_DECODER</code>
      </p>
      <div className="dc-actions">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          data-testid="dc-run"
        >
          {busy ? 'Decoding…' : 'Run pixel decode'}
        </button>
        {outcome && (
          <span className="dc-frame-info">
            frame {outcome.frameWidthPx}×{outcome.frameHeightPx} ·{' '}
            {outcome.candidateCount} label(s) in frame · t={outcome.simTimeMs} ms
          </span>
        )}
      </div>
      {error && (
        <p className="dc-error" data-testid="dc-error">{error}</p>
      )}
      {!outcome && !error && (
        <p className="dc-hint">
          {cameraId
            ? `Run the pixel decode to compare against the geometry verdicts for ${cameraId}.`
            : 'Select a camera to enable the pixel decode.'}
        </p>
      )}
      {outcome && (
        <table className="dc-table" data-testid="dc-table">
          <thead>
            <tr>
              <th>Face</th>
              <th>Truth</th>
              <th>Geometry</th>
              <th>Pixel</th>
              <th>Conf</th>
              <th>Pixel reasons</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l) => {
              const px = pixelFor(l.labelInstanceId);
              const inCandidates = candidateIds.has(l.labelInstanceId);
              const geomRead =
                l.qualityPassed && l.decodedPayload !== undefined
                  ? `decodes: ${l.decodedPayload}`
                  : l.qualityPassed
                    ? 'readable (quality pass)'
                    : `not readable (${l.reasons.join(', ') || 'gates'})`;
              return (
                <tr key={l.labelInstanceId}>
                  <td>{l.face}</td>
                  <td>{truthFor(l.labelInstanceId)}</td>
                  <td>{inCandidates ? geomRead : 'out of frame'}</td>
                  <td>
                    {px
                      ? px.decoded
                        ? `decodes: ${px.decodedPayload}`
                        : 'no decode'
                      : 'not in frame'}
                  </td>
                  <td>{px ? px.confidence.toFixed(2) : '—'}</td>
                  <td>{px && px.reasons.length ? px.reasons.join(', ') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

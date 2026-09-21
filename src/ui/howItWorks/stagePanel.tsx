/**
 * Reusable preprocessing-stage tile panel.
 *
 * Stage images are OFFLINE manifest assets (produced by the Python/OpenCV
 * generator) — nothing is filtered in the browser. Each tile carries the
 * capture's id so provenance is visible in the DOM, and the candidate
 * overlay tile gets an honesty label when the candidate did not come from
 * the capture's pixels (geometry/manual placement).
 */

import type { CaptureRecord, StageName } from './replayManifest';

/** Operation name shown under each stage tile (plan §step 3/6 vocabulary). */
export const STAGE_LABELS: Record<StageName, string> = {
  raw: 'Raw image',
  maskedCrop: 'Static mask / parcel crop',
  grayscaleContrast: 'Luminance & contrast',
  edgeMap: 'Edge / transition map',
  candidateOverlay: 'Barcode candidate',
  rectifiedCrop: 'Rectified barcode crop',
};

/** Sub-notes for stages that need framing. */
export const STAGE_NOTES: Partial<Record<StageName, string>> = {
  // Plan step 3: edge marks indicate transitions; they are not decoded values.
  edgeMap: 'Transitions only — not decoded values',
};

/** Honesty label for non-pixel candidate sources (NFR-002). */
export const ILLUSTRATIVE_NOTE = 'illustrative candidate location';

export interface StagePanelProps {
  capture: CaptureRecord;
  /** Two-column grid (default) vs single column for narrow panels. */
  compact?: boolean;
}

export function StagePanel({ capture, compact = false }: StagePanelProps) {
  return (
    <div
      className={`stage-panel${compact ? ' stage-panel-compact' : ''}`}
      data-testid="stage-panel"
      data-capture-id={capture.captureId}
    >
      {capture.stages.map((stage) => {
        const illustrative =
          stage.stage === 'candidateOverlay' &&
          !!capture.candidate &&
          capture.candidate.source !== 'pixels';
        return (
          <figure
            className="stage-tile"
            key={stage.stage}
            data-testid={`stage-tile-${stage.stage}`}
            data-capture-id={capture.captureId}
          >
            <img
              src={stage.path}
              alt={`${STAGE_LABELS[stage.stage]} (${capture.captureId})`}
              data-testid={`stage-img-${stage.stage}`}
              loading="lazy"
            />
            <figcaption className="stage-caption">
              <span className="stage-name">{STAGE_LABELS[stage.stage]}</span>
              {STAGE_NOTES[stage.stage] && (
                <span className="stage-note">{STAGE_NOTES[stage.stage]}</span>
              )}
              {illustrative && (
                <span
                  className="stage-note stage-note-illustrative"
                  data-testid="stage-illustrative-note"
                >
                  {ILLUSTRATIVE_NOTE}
                </span>
              )}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/**
 * Step 3: line-scan image preparation.
 *
 * The box is held at the end of the first section while the right panel
 * walks the six-stage pipeline: raw strip → static mask/parcel crop →
 * luminance/contrast adjustment → edge/transition map → barcode candidate
 * box → rectified barcode crop.
 *
 * All stage images are OFFLINE manifest assets — preparation narrows the
 * search and makes the bars easier to read; no filtering happens in the
 * browser.
 */

import type { CaptureRecord, ReplayManifest } from './replayManifest';
import { stepIndexAt } from './playbackStore';
import { StagePanel } from './stagePanel';

export function step3Capture(
  manifest: ReplayManifest,
  timeMs: number,
): CaptureRecord | undefined {
  const step = manifest.steps[stepIndexAt(manifest.steps, manifest.durationMs, timeMs)];
  const capture = manifest.captures.find((c) => c.captureId === step.captureId);
  return capture && capture.kind === 'LINE_SCAN' ? capture : undefined;
}

export function Step3Prep({
  manifest,
  timeMs,
}: {
  manifest: ReplayManifest;
  timeMs: number;
}) {
  const capture = step3Capture(manifest, timeMs);
  if (!capture) {
    return (
      <div className="step3-prep" data-testid="step3-no-capture">
        No line-scan capture in this step.
      </div>
    );
  }
  return (
    <div
      className="step3-prep"
      data-testid="step3-prep"
      data-capture-id={capture.captureId}
    >
      <p className="step3-caption">
        Preparation narrows the search and makes the bars easier to read.
      </p>
      <StagePanel capture={capture} />
    </div>
  );
}

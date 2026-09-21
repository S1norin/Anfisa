/**
 * Step 6: side-image preparation (t5-1).
 *
 * Scene: the camera + parcel pose that produced the selected frame is
 * FROZEN — the parcel is held at the capture's encoder position for the
 * whole step (story keyframes keep moving; this step pins them), and the
 * selected camera's cone is emphasized.
 *
 * Right panel: the 2D stage chain from the manifest (raw → static mask /
 * parcel ROI → luminance & contrast → edge map → barcode candidate quad →
 * perspective-corrected crop), quality annotations (glare / low contrast)
 * when the manifest metadata flags them, and the decoded value — the
 * PIXEL decode of the perspective-corrected crop via the browser ZXing
 * engine. Cameras whose frame has no label say so honestly (no
 * fabricated value, no fake decode failure).
 *
 * Display path only — the analysis pipeline is untouched; association and
 * dedup land in steps 7–8.
 */

import { useEffect, useState } from 'react';
import type { CaptureRecord, ReplayManifest } from './replayManifest';
import { stepIndexAt } from './playbackStore';
import { decodeRectifiedCrop, type DecodeOutcome } from './cropDecode';
import { StagePanel } from './stagePanel';
import type { SideCamId } from './step5SideCameras';

/**
 * The AREA capture being prepared in step 6: the selected camera's frame
 * (the same selection the user made in step 5). Null outside step 6.
 */
export function sidePrepCaptureAt(
  manifest: ReplayManifest,
  tMs: number,
  selectedId: SideCamId,
): CaptureRecord | null {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, tMs);
  if (manifest.steps[idx].step !== 6) return null;
  return (
    manifest.captures.find(
      (c) => c.kind === 'AREA_CAMERA' && c.sensorId === selectedId,
    ) ?? null
  );
}

/**
 * Frozen-parcel encoder position during step 6: the box is held at the
 * encoder position of the selected capture — the pose that produced the
 * frame — for the whole step. Null outside step 6.
 */
export function frozenFrontZAt(
  manifest: ReplayManifest,
  tMs: number,
  selectedId: SideCamId,
): number | null {
  const capture = sidePrepCaptureAt(manifest, tMs, selectedId);
  return capture ? capture.encoderSpanMm[0] : null;
}

/**
 * Quality annotations from manifest metadata: the explicit no-read
 * reasons (glare, low contrast, …) recorded for the prepared frame.
 */
export function qualityFlags(capture: CaptureRecord): string[] {
  const expected = capture.expectedDecode;
  return expected && !expected.decoded ? expected.reasons : [];
}

export function Step6SidePrep({
  manifest,
  timeMs,
  selectedId,
  decode = decodeRectifiedCrop,
}: {
  manifest: ReplayManifest;
  timeMs: number;
  selectedId: SideCamId;
  decode?: (capture: CaptureRecord) => Promise<DecodeOutcome>;
}) {
  const capture = sidePrepCaptureAt(manifest, timeMs, selectedId);

  const [outcome, setOutcome] = useState<DecodeOutcome | null>(null);

  useEffect(() => {
    if (!capture || !capture.decodeCropPath) {
      setOutcome(null);
      return;
    }
    let cancelled = false;
    setOutcome(null);
    decode(capture)
      .then((o) => {
        if (!cancelled) setOutcome(o);
      })
      .catch(() => {
        if (!cancelled) {
          setOutcome({
            decoded: false,
            reasons: ['ASSET:DECODE_FAILED'],
            sampleLines: [],
            widthPx: 0,
            heightPx: 0,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [capture, decode]);

  if (!capture) {
    return (
      <div className="step6-prep" data-testid="step6-no-capture">
        No side-camera frame selected for preparation in this step.
      </div>
    );
  }

  const flags = qualityFlags(capture);
  const hasCrop = !!capture.decodeCropPath;

  return (
    <div
      className="step6-prep"
      data-testid="step6-prep"
      data-capture-id={capture.captureId}
      data-sensor={capture.sensorId}
    >
      <p className="step6-frozen" data-testid="step6-frozen">
        Pose frozen: {capture.sensorId} at encoder {capture.encoderSpanMm[0]}{' '}
        mm — the camera and box positions that produced this frame.
      </p>
      {flags.length > 0 && (
        <div className="step6-flags" data-testid="step6-quality-flags">
          {flags.map((f) => (
            <span key={f} className="step6-flag" data-testid="step6-flag">
              {f}
            </span>
          ))}
        </div>
      )}
      <StagePanel capture={capture} />
      {hasCrop ? (
        <figure className="step6-crop" data-testid="step6-crop">
          <img
            src={capture.decodeCropPath}
            alt={`Perspective-corrected crop (${capture.captureId})`}
            data-testid="step6-crop-img"
          />
          <figcaption>
            Perspective-corrected crop — decoded in the browser
          </figcaption>
        </figure>
      ) : (
        <div className="step6-no-crop" data-testid="step6-no-crop">
          No label in this frame — nothing to correct or decode.
        </div>
      )}
      {outcome &&
        (outcome.decoded ? (
          <div className="step6-value" data-testid="step6-value">
            {outcome.payload}
          </div>
        ) : (
          <div className="step6-no-read" data-testid="step6-no-read">
            <span className="step6-no-read-label">no read</span>
            {outcome.reasons.map((r) => (
              <span key={r} className="step6-reason" data-testid="step6-reason">
                {r}
              </span>
            ))}
          </div>
        ))}
    </div>
  );
}

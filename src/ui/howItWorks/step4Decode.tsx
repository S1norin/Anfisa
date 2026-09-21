/**
 * Step 4: line-scan decode (t3-4).
 *
 * Scene: the reader (top/bottom) that FOUND the candidate is highlighted.
 *
 * Right panel: the rectified barcode crop with sample lines across it
 * (dark/light run widths — bar/space transitions, not decoded values),
 * then the decoded Code 128 string from the BROWSER ZXing decode of the
 * manifest rectified crop. When there is no read, the explicit reasons
 * are shown and no value is fabricated.
 *
 * Display path only — the analysis pipeline is untouched.
 */

import { useEffect, useState } from 'react';
import type { CaptureRecord, ReplayManifest } from './replayManifest';
import { stepIndexAt } from './playbackStore';
import {
  decodeRectifiedCrop,
  type DecodeOutcome,
} from './cropDecode';
import type { SampleLine } from './decodeRuns';

/** Reader face of a line-scan sensor ('ls-top' → 'top', …). */
export function readerFace(sensorId: string): 'top' | 'bottom' | 'side' {
  if (sensorId.startsWith('ls-top')) return 'top';
  if (sensorId.startsWith('ls-bottom')) return 'bottom';
  return 'side';
}

/**
 * Scene-state: the decode highlight is active during step 4 — the reader
 * that found the candidate. Returns null outside step 4.
 */
export function decodeHighlightAt(
  manifest: ReplayManifest,
  tMs: number,
): { capture: CaptureRecord; reader: 'top' | 'bottom' | 'side' } | null {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, tMs);
  const step = manifest.steps[idx];
  if (step.step !== 4) return null;
  const capture = manifest.captures.find((c) => c.captureId === step.captureId);
  if (!capture || capture.kind !== 'LINE_SCAN') return null;
  return { capture, reader: readerFace(capture.sensorId) };
}

function RunsReadout({ line }: { line: SampleLine }) {
  return (
    <div className="step4-runs" data-testid="step4-runs">
      {line.runs.map((run, i) => (
        <span
          key={i}
          className={`step4-run ${run.dark ? 'step4-run-dark' : 'step4-run-light'}`}
          data-testid="step4-run-seg"
          style={{ flexGrow: run.widthPx, flexBasis: 0 }}
          title={run.dark ? `dark bar ${run.widthPx}px` : `light space ${run.widthPx}px`}
        />
      ))}
      <span className="step4-runs-count">
        {line.runs.filter((r) => r.dark).length} bars /{' '}
        {line.runs.filter((r) => !r.dark).length} spaces
      </span>
    </div>
  );
}

export function Step4Decode({
  manifest,
  timeMs,
  decode = decodeRectifiedCrop,
}: {
  manifest: ReplayManifest;
  timeMs: number;
  decode?: (capture: CaptureRecord) => Promise<DecodeOutcome>;
}) {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, timeMs);
  const step = manifest.steps[idx];
  const capture = manifest.captures.find(
    (c) => c.captureId === step.captureId,
  );

  const [outcome, setOutcome] = useState<DecodeOutcome | null>(null);

  useEffect(() => {
    if (!capture || capture.kind !== 'LINE_SCAN') {
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

  if (!capture || capture.kind !== 'LINE_SCAN') {
    return (
      <div className="step4-decode" data-testid="step4-decode">
        No line-scan capture in this step.
      </div>
    );
  }

  const reader = readerFace(capture.sensorId);

  return (
    <div className="step4-decode" data-testid="step4-decode">
      <div className="step4-reader" data-testid="step4-reader" data-reader={reader}>
        {reader} reader found the candidate
      </div>
      {capture.decodeCropPath && (
        <figure className="step4-crop" data-testid="step4-crop">
          <img src={capture.decodeCropPath} alt="Rectified barcode crop" />
          {outcome && outcome.widthPx > 0 && (
            <div className="step4-sample-lines" data-testid="step4-sample-lines">
              {outcome.sampleLines.map((line, k) => (
                <div
                  key={k}
                  className="step4-sample-line"
                  data-testid="step4-sample-line"
                  style={{
                    top: `${((line.y + 0.5) / outcome.heightPx) * 100}%`,
                  }}
                />
              ))}
            </div>
          )}
        </figure>
      )}
      {outcome && outcome.sampleLines.length > 0 && (
        <div className="step4-runs-block" data-testid="step4-runs-block">
          <div className="step4-runs-title">
            dark / light runs on sample line 1
          </div>
          <RunsReadout line={outcome.sampleLines[0]} />
        </div>
      )}
      {outcome &&
        (outcome.decoded ? (
          <div className="step4-value" data-testid="step4-value">
            {outcome.payload}
          </div>
        ) : (
          <div className="step4-no-read" data-testid="step4-no-read">
            <span className="step4-no-read-label">no read</span>
            {outcome.reasons.map((r) => (
              <span key={r} className="step4-reason" data-testid="step4-reason">
                {r}
              </span>
            ))}
          </div>
        ))}
    </div>
  );
}

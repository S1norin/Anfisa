/**
 * Line-scan strip view (t3-1, subtask s2): the faithful strip rows
 * (buildHiwLineStripRows, pixel-verified against the manifest raw strip)
 * displayed progressively — rows are APPENDED IN ENCODER ORDER and the
 * view stays synchronized to the encoder: a ruler marker relates the
 * current row to the box position (parcel front Z).
 *
 * ONE clock: the view takes `frontZMm` (the parcel pose at story time)
 * and derives the visible row count from the capture's encoder span.
 * Display-only: the rows come from the pure generator in stripPreview;
 * the decode path is untouched.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  buildHiwLineStripRows,
  compositeHiwStripRows,
  HIW_STRIP,
} from '../../capture/stripPreview';
import { parcelFrontZAt } from './layout';
import type { ReplayManifest, CaptureRecord } from './replayManifest';

/** One encoder interval per row across the capture's span. */
export interface HiwStripSync {
  totalRows: number;
  /** Rows acquired so far (encoder order, from the span start). */
  visibleRows: number;
  /** Encoder position within the capture span, 0..100 (%). */
  encoderPct: number;
  spanStartMm: number;
  spanEndMm: number;
}

/**
 * How many strip rows are visible for a parcel front position. Pure:
 * `frontZMm < spanStart` → 0 rows; `frontZMm >= spanEnd` → all rows.
 * The row count is monotonically non-decreasing in frontZMm.
 */
export function hiwStripSync(
  spanStartMm: number,
  spanEndMm: number,
  frontZMm: number,
  totalRows: number = HIW_STRIP.rows,
): HiwStripSync {
  const span = spanEndMm - spanStartMm;
  const frac = span > 0 ? Math.min(1, Math.max(0, (frontZMm - spanStartMm) / span)) : 0;
  return {
    totalRows,
    visibleRows: Math.min(totalRows, Math.max(0, Math.floor(frac * totalRows))),
    encoderPct: frac * 100,
    spanStartMm,
    spanEndMm,
  };
}

/** The TOP-face payload of a LINE_SCAN capture's sensor (drives the rows). */
export function lineScanPayload(
  manifest: ReplayManifest,
  capture: CaptureRecord,
): string {
  const face = manifest.sensors.find((s) => s.id === capture.sensorId)?.face;
  const label =
    (face && manifest.parcel.labels.find((l) => l.face === face)) ||
    manifest.parcel.labels[0];
  return label ? label.payload : '';
}

/** Pending (not yet acquired) rows, canvas background. */
const PENDING_FILL = '#0d1117';

export interface StripViewProps {
  capture: CaptureRecord;
  /** Label payload the strip encodes (TOP face for the top scan). */
  payload: string;
  /** Parcel front Z (mm) at the current story time — the encoder input. */
  frontZMm: number;
}

/**
 * Progressive line-scan strip: the faithful rows (parcel face + label +
 * Code 128 barcode) appended top→bottom in encoder order, with a scanline
 * and a ruler marker at the current row — the box position.
 */
export function StripView({ capture, payload, frontZMm }: StripViewProps) {
  const [z0, z1] = capture.encoderSpanMm;
  const sync = hiwStripSync(z0, z1, frontZMm);
  const strip = useMemo(() => buildHiwLineStripRows(payload), [payload]);
  const composite = useMemo(
    () => compositeHiwStripRows(strip, sync.visibleRows),
    [strip, sync.visibleRows],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return; // jsdom: DOM attrs carry the state
    ctx.fillStyle = PENDING_FILL;
    ctx.fillRect(0, 0, strip.widthPx, strip.rows);
    if (composite.rowCount > 0) {
      const img = ctx.createImageData(strip.widthPx, composite.rowCount);
      img.data.set(composite.rgba);
      ctx.putImageData(img, 0, 0);
    }
  }, [strip, composite]);

  const { totalRows, visibleRows, encoderPct } = sync;

  return (
    <div className="hiw-strip" data-testid="hiw-strip">
      <div className="hiw-strip-head">
        <span className="hiw-strip-title" data-testid="hiw-strip-title">
          {capture.captureId}
        </span>
        <span data-testid="hiw-strip-rows">
          {visibleRows} / {totalRows} rows
        </span>
      </div>
      <div className="hiw-strip-canvas-wrap" data-testid="hiw-strip-canvas-wrap">
        <canvas
          ref={canvasRef}
          data-testid="hiw-strip-canvas"
          data-visible-rows={visibleRows}
          width={strip.widthPx}
          height={strip.rows}
        />
        {visibleRows < totalRows && (
          <div
            className="hiw-strip-scanline"
            data-testid="hiw-strip-scanline"
            style={{ top: `${encoderPct}%` }}
          />
        )}
      </div>
      <div className="hiw-strip-ruler" data-testid="hiw-strip-ruler">
        <span className="hiw-strip-ruler-bounds">{z0} mm</span>
        <div className="hiw-strip-ruler-track" data-testid="hiw-strip-ruler-track">
          <div
            className="hiw-strip-ruler-marker"
            data-testid="hiw-strip-ruler-marker"
            style={{ left: `${encoderPct}%` }}
          />
        </div>
        <span className="hiw-strip-ruler-bounds">{z1} mm</span>
        <span data-testid="hiw-strip-encoder-value">{Math.round(frontZMm)} mm</span>
      </div>
    </div>
  );
}

/**
 * Convenience for the shell: strip rows for a LINE_SCAN capture at story
 * time `tMs` (pose from the manifest keyframes).
 */
export function hiwStripSyncAt(
  manifest: ReplayManifest,
  capture: CaptureRecord,
  tMs: number,
): HiwStripSync {
  const [z0, z1] = capture.encoderSpanMm;
  return hiwStripSync(z0, z1, parcelFrontZAt(manifest.keyframes, tMs));
}

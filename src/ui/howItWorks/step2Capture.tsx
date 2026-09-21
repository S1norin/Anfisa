/**
 * Step 2: line-scan capture view (t3-2).
 *
 * Scene: the top and bottom cross-belt scan planes glow while the box
 * crosses the line-scan section, and the bottom optical gap (the exposed
 * underside) is revealed.
 *
 * Right panel: one thin 1D sensor row (the current line) appears first,
 * then rows are appended in encoder order into the 2D TOP strip (the
 * faithful t3-1 rows — parcel face + label + barcode) and the 2D BOTTOM
 * strip. The bottom strip contains ONLY the rows where the optical gap
 * exposes the underside (gap-geometry clipped). Markers relate the
 * current row to the box position.
 *
 * Display-only; the decode path is untouched.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  buildHiwKraftStripRows,
  compositeHiwStripRange,
  HIW_STRIP,
  type HiwLineStrip,
} from '../../capture/stripPreview';
import { GAP_OPENING_MM, defaultConfig } from '../../domain/config';
import type { SimConfig } from '../../domain/config';
import { parcelFrontZAt } from './layout';
import { StripView, hiwStripSync, lineScanPayload } from './stripView';
import { stepIndexAt } from './playbackStore';
import type { ReplayManifest, CaptureRecord } from './replayManifest';

/** Story parcel length (mm) — mirrors storyParcelAt's spec in layout. */
export const STORY_PARCEL_LENGTH_MM = 350;

/** Story parcel top (mm) — mirrors storyParcelAt's spec in layout. */
export const STORY_PARCEL_TOP_MM = 220;

/**
 * The bottom face is optically exposed (visible from the bottom reader)
 * over this belt-z range:
 *  - SIDE_GRIP: the whole transfer zone [0, L] (no deck under the belt);
 *  - GAP: the 100 mm bottom opening centred on the station.
 */
export function bottomExposedZRange(cfg: SimConfig): [number, number] {
  const L = cfg.station.lengthMm;
  if (cfg.station.bottomTransfer === 'GAP') {
    const mid = L / 2;
    const half = GAP_OPENING_MM / 2;
    return [mid - half, mid + half];
  }
  return [0, L];
}

/**
 * Which rows of a LINE_SCAN capture's strip the bottom strip may contain:
 * the rows whose z interval falls inside the exposed (gap) range.
 */
export function bottomStripRowRange(
  spanStartMm: number,
  spanEndMm: number,
  exposedStartMm: number,
  exposedEndMm: number,
  totalRows: number = HIW_STRIP.rows,
): { fromRow: number; rowCount: number } {
  const span = spanEndMm - spanStartMm;
  const lo = Math.max(spanStartMm, exposedStartMm);
  const hi = Math.min(spanEndMm, exposedEndMm);
  if (span <= 0 || hi <= lo) return { fromRow: 0, rowCount: 0 };
  const fromRow = Math.floor(((lo - spanStartMm) / span) * totalRows);
  const toRow = Math.ceil(((hi - spanStartMm) / span) * totalRows);
  return { fromRow, rowCount: Math.max(0, toRow - fromRow) };
}

/**
 * True while any part of the story box is inside the line-scan section
 * (front past the span start, rear not yet past the span end). The scan
 * planes glow exactly during this crossing.
 */
export function lineScanGlowActive(
  capture: CaptureRecord,
  frontZMm: number,
): boolean {
  const [z0, z1] = capture.encoderSpanMm;
  return frontZMm > z0 && frontZMm - STORY_PARCEL_LENGTH_MM < z1;
}

/** Scene highlight active at story time t (drives the 3D panel). */
export function lineScanHighlightAt(
  manifest: ReplayManifest,
  tMs: number,
): CaptureRecord | null {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, tMs);
  const captureId = manifest.steps[idx].captureId;
  const capture = captureId
    ? manifest.captures.find((c) => c.captureId === captureId)
    : undefined;
  if (!capture || capture.kind !== 'LINE_SCAN') return null;
  if (!lineScanGlowActive(capture, parcelFrontZAt(manifest.keyframes, tMs))) {
    return null;
  }
  return capture;
}

/**
 * 3D highlight: top + bottom cross-belt scan planes over the scan section,
 * and the revealed bottom optical gap (exposed underside + bottom reader).
 */
export function LineScanCaptureHighlight({
  beltWidthMm,
  z0Mm,
  z1Mm,
  parcelTopMm = STORY_PARCEL_TOP_MM,
  exposed,
  found = null,
}: {
  beltWidthMm: number;
  z0Mm: number;
  z1Mm: number;
  parcelTopMm?: number;
  /** Bottom optical gap exposed (underside visible to the bottom reader). */
  exposed: boolean;
  /** Reader that FOUND the candidate (step 4 decode highlight). */
  found?: 'top' | 'bottom' | 'side' | null;
}) {
  const w = beltWidthMm / 1000 + 0.08;
  const z0 = z0Mm / 1000;
  const z1 = z1Mm / 1000;
  const zc = (z0 + z1) / 2;
  const dz = Math.max(0.02, z1 - z0);
  const topFound = found === 'top';
  const bottomFound = found === 'bottom';
  return (
    // userData (not a dashed data-* prop: R3F v8 walks dashed keys as
    // nested property paths and crashes on Object3D, which has no `data`).
    <group name="line-scan-highlight" userData={{ found: found ?? '' }}>
      {/* Top cross-belt scan plane at the parcel top face */}
      <mesh position={[0, parcelTopMm / 1000 + 0.004, zc]}>
        <boxGeometry args={[w, 0.01, dz]} />
        <meshBasicMaterial
          color={topFound ? '#7cc0ff' : '#4da3ff'}
          transparent
          opacity={topFound ? 0.6 : 0.32}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, parcelTopMm / 1000 + 0.009, zc]}>
        <boxGeometry args={[w, 0.005, 0.005]} />
        <meshBasicMaterial color="#7cc0ff" transparent opacity={0.95} />
      </mesh>
      {/* Bottom cross-belt scan plane at the belt surface */}
      <mesh position={[0, 0.002, zc]}>
        <boxGeometry args={[w, 0.01, dz]} />
        <meshBasicMaterial
          color={bottomFound ? '#8ee6a1' : '#3fb950'}
          transparent
          opacity={bottomFound ? 0.55 : 0.3}
          depthWrite={false}
        />
      </mesh>
      {/* Revealed bottom optical gap: the exposed underside + bottom reader */}
      {exposed && (
        <>
          <mesh position={[0, -0.045, zc]}>
            <boxGeometry args={[Math.max(0.1, w - 0.14), 0.012, dz * 0.92]} />
            <meshBasicMaterial color="#3fb950" transparent opacity={0.5} depthWrite={false} />
          </mesh>
          <mesh position={[0, -0.4, zc]}>
            <boxGeometry args={[0.06, 0.04, 0.06]} />
            <meshBasicMaterial color="#8ee6a1" />
          </mesh>
        </>
      )}
    </group>
  );
}

/** Pending (not yet acquired) rows, canvas background. */
const PENDING_FILL = '#0d1117';

function useStripCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  strip: HiwLineStrip,
  composite: { rowCount: number; rgba: Uint8ClampedArray },
  fromRow: number,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return; // jsdom: DOM attrs carry the state
    ctx.fillStyle = PENDING_FILL;
    ctx.fillRect(0, 0, strip.widthPx, strip.rows);
    if (composite.rowCount > 0) {
      const img = ctx.createImageData(strip.widthPx, composite.rowCount);
      img.data.set(composite.rgba);
      // Rows land at their encoder offset so the strip stays ruler-aligned.
      ctx.putImageData(img, 0, fromRow);
    }
  }, [canvasRef, strip, composite, fromRow]);
}

/**
 * Bottom strip: bare-kraft rows, clipped to the rows where the optical
 * gap exposes the underside, appended in encoder order as the box travels.
 */
export function BottomStripView({
  capture,
  exposedRange,
  frontZMm,
  seed = 42,
}: {
  capture: CaptureRecord;
  exposedRange: [number, number];
  frontZMm: number;
  seed?: number;
}) {
  const [z0, z1] = capture.encoderSpanMm;
  const totalRows = HIW_STRIP.rows;
  const span = z1 - z0;
  const { fromRow, rowCount } = bottomStripRowRange(
    z0,
    z1,
    exposedRange[0],
    exposedRange[1],
    totalRows,
  );
  const exposedLo = Math.max(z0, exposedRange[0]);
  const exposedHi = Math.min(z1, exposedRange[1]);
  // Rows acquired so far: z below the parcel front, within the exposed span.
  const acquiredHi = Math.min(frontZMm, exposedHi);
  // fromRow === floor(((exposedLo - z0) / span) * totalRows), so rows
  // acquired above exposedLo map to 0-based indices directly.
  const visibleCount =
    acquiredHi <= exposedLo || rowCount === 0
      ? 0
      : Math.min(rowCount, Math.max(0, Math.floor(((acquiredHi - exposedLo) / span) * totalRows)));
  const strip = useMemo(() => buildHiwKraftStripRows(seed), [seed]);
  const composite = useMemo(
    () => compositeHiwStripRange(strip, fromRow, visibleCount),
    [strip, fromRow, visibleCount],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useStripCanvas(canvasRef, strip, composite, fromRow);

  const encoderPct =
    span > 0 ? Math.min(100, Math.max(0, ((frontZMm - z0) / span) * 100)) : 0;
  // The canvas shows [fromRow, fromRow+rowCount): the scanline tracks the
  // fill fraction within that exposed range.
  const fillPct =
    rowCount > 0 ? Math.min(100, (visibleCount / rowCount) * 100) : 0;

  return (
    <div className="hiw-strip hiw-strip-bottom" data-testid="hiw-strip-bottom">
      <div className="hiw-strip-head">
        <span className="hiw-strip-title" data-testid="hiw-strip-bottom-title">
          bottom strip — gap-exposed rows only
        </span>
        <span data-testid="hiw-strip-bottom-rows">
          {visibleCount} / {rowCount} rows
        </span>
      </div>
      <div className="hiw-strip-canvas-wrap" data-testid="hiw-strip-bottom-canvas-wrap">
        <canvas
          ref={canvasRef}
          data-testid="hiw-strip-bottom-canvas"
          data-visible-rows={visibleCount}
          width={strip.widthPx}
          height={strip.rows}
        />
        {visibleCount < rowCount && (
          <div
            className="hiw-strip-scanline"
            data-testid="hiw-strip-bottom-scanline"
            style={{ top: `${fillPct}%` }}
          />
        )}
      </div>
      <div className="hiw-strip-ruler" data-testid="hiw-strip-bottom-ruler">
        <span className="hiw-strip-ruler-bounds">{z0} mm</span>
        <div className="hiw-strip-ruler-track" data-testid="hiw-strip-bottom-ruler-track">
          <div
            className="hiw-strip-ruler-marker"
            data-testid="hiw-strip-bottom-ruler-marker"
            style={{ left: `${encoderPct}%` }}
          />
        </div>
        <span className="hiw-strip-ruler-bounds">{z1} mm</span>
      </div>
    </div>
  );
}

/**
 * Right-panel step 2 content: current 1D sensor row + the 2D top strip
 * (faithful rows) + the 2D bottom strip (gap-clipped kraft rows).
 */
export function Step2Capture({
  manifest,
  timeMs,
}: {
  manifest: ReplayManifest;
  timeMs: number;
}) {
  const capture = manifest.captures.find(
    (c) => c.captureId === manifest.steps[stepIndexAt(manifest.steps, manifest.durationMs, timeMs)].captureId,
  );
  if (!capture || capture.kind !== 'LINE_SCAN') {
    return <div className="step2-capture">No line-scan capture in this step.</div>;
  }
  const frontZ = parcelFrontZAt(manifest.keyframes, timeMs);
  const [z0, z1] = capture.encoderSpanMm;
  const sync = hiwStripSync(z0, z1, frontZ);
  const payload = lineScanPayload(manifest, capture);

  return (
    <div className="step2-capture" data-testid="step2-capture">
      <div
        className="step2-current-row"
        data-testid="step2-current-row"
        data-active={sync.visibleRows > 0 && sync.visibleRows < sync.totalRows}
        data-row-index={Math.max(0, sync.visibleRows - 1)}
      >
        <span className="step2-current-row-label">current sensor line</span>
        <span data-testid="step2-current-row-value">
          {sync.visibleRows > 0 ? `row ${sync.visibleRows - 1}` : '— awaiting scan —'}
        </span>
      </div>
      <div className="step2-strip-block" data-testid="step2-top-strip-block">
        <div className="step2-strip-label">top strip — {capture.sensorId}</div>
        <StripView capture={capture} payload={payload} frontZMm={frontZ} />
      </div>
      <div className="step2-strip-block" data-testid="step2-bottom-strip-block">
        <BottomStripView
          capture={capture}
          exposedRange={bottomExposedZRange(defaultCfg)}
          frontZMm={frontZ}
        />
      </div>
    </div>
  );
}

/** Module-level default config (display-only geometry; no allocation per render). */
const defaultCfg = defaultConfig();

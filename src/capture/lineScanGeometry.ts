/**
 * Pure line-scan geometry & sampling helpers (line-scan plan, Part 2).
 *
 * A line scanner acquires one cross-belt sensor row per encoder step; the
 * belt travel supplies the second image axis. These formulas are the shared
 * source for sim line-rate limits (t4), strip observation sampling (t5), and
 * the Camera Lab readouts (t10). No side effects, no clock reads (NFR-006).
 */

/**
 * Required line rate (lines/s) for a belt speed:
 * `velocityMmPerSec / encoderStepMmPerLine`. If this exceeds the rig's
 * maxLineRateLinesPerSec, along-travel sampling degrades (LOW_PPM by design).
 */
export function requiredLineRate(
  velocityMmPerSec: number,
  encoderStepMmPerLine: number,
): number {
  return velocityMmPerSec / encoderStepMmPerLine;
}

/** Fractional lines expected for a travel distance (may be non-integer). */
export function expectedLineCount(
  travelMm: number,
  encoderStepMmPerLine: number,
): number {
  return travelMm / encoderStepMmPerLine;
}

/** Integer lines in a completed strip: floor(travel / step). */
export function completedLineCount(
  travelMm: number,
  encoderStepMmPerLine: number,
): number {
  return Math.floor(travelMm / encoderStepMmPerLine);
}

/** Belt width covered by one line-sensor pixel, mm. */
export function pixelPitchMm(pixelsPerLine: number, sensorWidthMm: number): number {
  return sensorWidthMm / pixelsPerLine;
}

/** Pixels per barcode module across the belt (cross-belt ppm). */
export function crossBeltPpm(
  xDimensionMm: number,
  pixelsPerLine: number,
  sensorWidthMm: number,
): number {
  return xDimensionMm / pixelPitchMm(pixelsPerLine, sensorWidthMm);
}

/** Travel lines per barcode module (along-travel sample density). */
export function travelPpm(xDimensionMm: number, encoderStepMmPerLine: number): number {
  return xDimensionMm / encoderStepMmPerLine;
}

/**
 * Effective ppm of a strip: the bottleneck axis —
 * min(cross-belt ppm, travel lines per module).
 */
export function effectivePpm(
  xDimensionMm: number,
  pixelsPerLine: number,
  sensorWidthMm: number,
  encoderStepMmPerLine: number,
): number {
  return Math.min(crossBeltPpm(xDimensionMm, pixelsPerLine, sensorWidthMm), travelPpm(xDimensionMm, encoderStepMmPerLine));
}

/** Per-edge plane-crossing result for one sim step. */
export interface PlaneCrossing {
  /** True if the front edge crossed the scan plane during this step. */
  frontCrossed: boolean;
  /** True if the rear edge crossed the scan plane during this step. */
  rearCrossed: boolean;
}

/**
 * True when an edge moved from one side of `planeZ` to the other (inclusive
 * on the landing side) between `prevZ` and `nextZ`. Direction-agnostic; for
 * monotonic motion each edge crosses at most once, robust to any step size
 * (large steps that skip the plane still register exactly one crossing).
 */
export function edgeCrossedPlane(prevZ: number, nextZ: number, planeZ: number): boolean {
  return (prevZ < planeZ && nextZ >= planeZ) || (prevZ > planeZ && nextZ <= planeZ);
}

/**
 * Front/rear plane-crossing detection for a parcel over one step. The
 * parcel's edges are `frontZMm`/`rearZMm`; the scan plane sits at
 * `scanPlaneZMm`. Exactly one crossing is reported per edge per pass.
 */
export function parcelPlaneCrossings(
  prevFrontZMm: number,
  prevRearZMm: number,
  nextFrontZMm: number,
  nextRearZMm: number,
  scanPlaneZMm: number,
): PlaneCrossing {
  return {
    frontCrossed: edgeCrossedPlane(prevFrontZMm, nextFrontZMm, scanPlaneZMm),
    rearCrossed: edgeCrossedPlane(prevRearZMm, nextRearZMm, scanPlaneZMm),
  };
}

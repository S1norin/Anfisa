/**
 * Encoder-synced line-scan sessions (t4, line-scan plan Part 2).
 *
 * A session opens when a parcel's front edge crosses the rig's scan plane,
 * accumulates lines from ENCODER displacement (never display time), and
 * closes when the parcel's rear edge crosses the plane. The event stream is
 * BOUNDED (O(parcels)): one STARTED plus one COMPLETED/ABORTED per
 * parcel-rig pass — never one event per line (NFR-006, plan Part 2).
 *
 * Close-spacing policy (plan: "handle multiple closely spaced parcels
 * without reassigning lines to the wrong package"): a new front crossing
 * while a session is open aborts the open session (CLOSE_SPACING); the
 * second parcel then owns the plane alone.
 */

import { completedLineCount, expectedLineCount, parcelPlaneCrossings } from './lineScanGeometry';
import type {
  CameraState,
  LineScanCameraConfig,
  ParcelState,
  SimEvent,
} from '../domain/types';

export type LineScanAbortReason = 'CAMERA_FAULT' | 'CLOSE_SPACING' | 'MAX_STRIP';

/** One in-flight strip (per line-scanner rig). */
export interface LineScanSession {
  cameraId: string;
  parcelId: string;
  scanPlaneZMm: number;
  startSimTimeMs: number;
  encoderStartMm: number;
  /** Encoder position through which `lineCount` lines are accounted. */
  lastEncoderMm: number;
  lineCount: number;
}

/** Parcel with its front-edge Z from the PREVIOUS step (motion already applied). */
export interface SteppedParcel {
  parcel: ParcelState;
  prevFrontZMm: number;
}

export interface LineScanStepInput {
  rigs: LineScanCameraConfig[];
  /** Open sessions per camera id; mutated in place (fixed-step domain). */
  sessions: Map<string, LineScanSession>;
  /** Deterministic parcel order (Map insertion order). */
  parcels: SteppedParcel[];
  encoderMm: number;
  simTimeMs: number;
  cameraStates: Record<string, CameraState>;
}

export interface LineScanStepOutput {
  events: SimEvent[];
}

function stripTravelMm(session: LineScanSession, encoderEndMm: number): number {
  return encoderEndMm - session.encoderStartMm;
}

function abortEvents(
  session: LineScanSession,
  reason: LineScanAbortReason,
  encoderEndMm: number,
  simTimeMs: number,
): SimEvent {
  return {
    type: 'LINE_SCAN_ABORTED',
    cameraId: session.cameraId,
    parcelId: session.parcelId,
    simTimeMs,
    encoderStartMm: session.encoderStartMm,
    encoderEndMm,
    lineCount: session.lineCount,
    durationMs: simTimeMs - session.startSimTimeMs,
    complete: false,
    reason,
  };
}

function completeEvents(
  session: LineScanSession,
  rig: LineScanCameraConfig,
  encoderEndMm: number,
  simTimeMs: number,
): SimEvent {
  const travelMm = stripTravelMm(session, encoderEndMm);
  return {
    type: 'LINE_SCAN_COMPLETED',
    cameraId: session.cameraId,
    parcelId: session.parcelId,
    simTimeMs,
    encoderStartMm: session.encoderStartMm,
    encoderEndMm,
    lineCount: completedLineCount(travelMm, rig.line.encoderStepMmPerLine),
    expectedLineCount: expectedLineCount(travelMm, rig.line.encoderStepMmPerLine),
    durationMs: simTimeMs - session.startSimTimeMs,
    complete: true,
  };
}

/**
 * Accumulate lines from encoder displacement for the open session of
 * `parcelId`. Pure arithmetic; mutates only the session's line counters.
 * The fractional remainder stays in `lastEncoderMm` (no per-step drift).
 */
export function advanceSessionLines(
  session: LineScanSession,
  rig: LineScanCameraConfig,
  encoderMm: number,
): void {
  const step = rig.line.encoderStepMmPerLine;
  const delta = encoderMm - session.lastEncoderMm;
  const newLines = Math.floor(delta / step);
  if (newLines > 0) {
    session.lineCount += newLines;
    session.lastEncoderMm += newLines * step;
  }
}

/**
 * Advance every line-scan rig by one fixed step. Deterministic: rigs in
 * config order, parcels in the given order. Returns the bounded events
 * emitted this step (0..N, O(parcels)).
 */
export function advanceLineScans(input: LineScanStepInput): LineScanStepOutput {
  const events: SimEvent[] = [];

  for (const rig of input.rigs) {
    const state = input.cameraStates[rig.id] ?? 'OFFLINE';
    let session = input.sessions.get(rig.id);

    // A faulted/disabled scanner aborts any open strip and stops starting
    // new ones (a disabled rig is OFFLINE per syncCameraStates).
    if (session && (state === 'FAULT' || state === 'OFFLINE')) {
      events.push(abortEvents(session, 'CAMERA_FAULT', input.encoderMm, input.simTimeMs));
      input.sessions.delete(rig.id);
      session = undefined;
    }
    if (!rig.enabled || state === 'FAULT' || state === 'OFFLINE') continue;

    for (const { parcel, prevFrontZMm } of input.parcels) {
      const lengthMm = parcel.spec.lengthMm;
      const frontZ = parcel.frontZMm;
      const rearZ = frontZ - lengthMm;
      const crossing = parcelPlaneCrossings(
        prevFrontZMm,
        prevFrontZMm - lengthMm,
        frontZ,
        rearZ,
        rig.line.scanPlaneZMm,
      );

      if (crossing.frontCrossed) {
        if (session) {
          if (session.parcelId === parcel.parcelId) continue;
          // Close spacing: a second parcel reaches the plane before the
          // first one's rear cleared it. Never interleave lines.
          events.push(abortEvents(session, 'CLOSE_SPACING', input.encoderMm, input.simTimeMs));
          input.sessions.delete(rig.id);
        }
        session = {
          cameraId: rig.id,
          parcelId: parcel.parcelId,
          scanPlaneZMm: rig.line.scanPlaneZMm,
          startSimTimeMs: input.simTimeMs,
          encoderStartMm: input.encoderMm,
          lastEncoderMm: input.encoderMm,
          lineCount: 0,
        };
        input.sessions.set(rig.id, session);
        events.push({
          type: 'LINE_SCAN_STARTED',
          cameraId: rig.id,
          parcelId: parcel.parcelId,
          simTimeMs: input.simTimeMs,
          encoderStartMm: input.encoderMm,
        });
        continue;
      }

      if (crossing.rearCrossed && session && session.parcelId === parcel.parcelId) {
        const travelMm = stripTravelMm(session, input.encoderMm);
        if (travelMm > rig.line.maxStripLengthMm) {
          events.push(abortEvents(session, 'MAX_STRIP', input.encoderMm, input.simTimeMs));
        } else {
          events.push(completeEvents(session, rig, input.encoderMm, input.simTimeMs));
        }
        input.sessions.delete(rig.id);
        session = undefined;
        continue;
      }

      if (session && session.parcelId === parcel.parcelId) {
        advanceSessionLines(session, rig, input.encoderMm);
      }
    }
  }

  return { events };
}

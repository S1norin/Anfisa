/**
 * Step 7: assign reads to the parcel (t6-1).
 *
 * Scene: the pixel-decoded observations travel as small cards from their
 * sensors toward the tracked parcel (green = decoded, amber = explicit
 * no-read). The cards are a pure function of story time — no extra clock.
 *
 * Right panel: one row per observation (sensor, time/encoder span,
 * candidate with its source label, decoded value OR the explicit no-read
 * reasons, and the association verdict). The verdict is computed LIVE with
 * the existing pipeline rules (src/pipeline/association.ts — imported,
 * never re-implemented), fed by the manifest's pixel-decoded
 * observations.
 *
 * Association semantics: the live pipeline associates at frame ARRIVAL, so
 * the replay evaluates each observation at its capture moment ("now" =
 * frame time). At arrival the parcel's pose IS the capture's own encoder
 * reading (the pose that produced the frame — authoritative over the
 * story keyframes, which are a coarser guide). An optional `nowMs` lets
 * tests exercise the window rules with a later "now" (stale frame →
 * POSITION_OUT_OF_WINDOW, …).
 *
 * Display path only — the analytic pipeline is untouched. Dedup and the
 * final result card land in step 8.
 */

import type { ParcelState } from '../../domain/types';
import {
  DEFAULT_ASSOCIATION_WINDOWS,
  associateLineStrip,
  associateObservation,
  type AssociationResult,
  type AssociationWindows,
} from '../../pipeline/association';
import type {
  CaptureRecord,
  ReplayManifest,
  ReplayObservation,
} from './replayManifest';
import { stepIndexAt } from './playbackStore';
import { parcelFrontZAt } from './layout';
import { SIDE_CAM_POSE } from './step5SideCameras';

/**
 * Story parcel length (mm) — the same box the 3D scene renders
 * (storyParcelAt in layout.tsx). The line-strip rule uses it to compute
 * the parcel's travel interval at the scan plane.
 */
export const STORY_PARCEL_LENGTH_MM = 350;

/**
 * Story line-scan plane z (mm): the keyframes hold the parcel at ~250 mm
 * while the top/bottom readers fire (see buildKeyframes in fixtures.ts).
 */
export const SCAN_PLANE_Z_MM = 250;

/**
 * The minimal ParcelState the association rules need: identity, the
 * ground-truth label instances (for the GHOST_INSTANCE check), box length
 * (for strip interval math), and the front position at story time t.
 */
export function replayParcelAt(
  manifest: ReplayManifest,
  tMs: number,
): ParcelState {
  return {
    parcelId: manifest.parcel.parcelId,
    spec: {
      widthMm: 250,
      heightMm: 220,
      lengthMm: STORY_PARCEL_LENGTH_MM,
      lateralOffsetMm: 0,
      yawDeg: 0,
      material: 'KRAFT',
      tape: true,
      labels: manifest.parcel.labels.map((l) => ({
        labelInstanceId: l.labelInstanceId,
        payload: l.payload,
        face: l.face,
        localOffsetMm: [0, 0] as [number, number],
        rotationDeg: 0,
        widthMm: 180,
        heightMm: 90,
        damage: 0,
      })),
    },
    spawnSimTimeMs: 0,
    spawnEncoderMm: manifest.keyframes[0].frontZMm,
    frontZMm: parcelFrontZAt(manifest.keyframes, tMs),
    phase: 'ENTERED',
  };
}

/**
 * Association verdict for ONE manifest observation, computed with the
 * existing pipeline rules:
 *  - LINE_SCAN captures use the interval rule (the strip's encoder span
 *    must overlap exactly one parcel's scan-plane travel interval);
 *  - AREA_CAMERA captures use the frame rule (position + time windows).
 *
 * Evaluated at the capture moment by default (frame arrival, as in the
 * live pipeline); `nowMs` overrides "now" to exercise the window checks.
 */
export function associateReplayObservation(
  manifest: ReplayManifest,
  obs: ReplayObservation,
  nowMs?: number,
  windows: AssociationWindows = DEFAULT_ASSOCIATION_WINDOWS,
): AssociationResult {
  const capture = manifest.captures.find((c) => c.captureId === obs.captureId);
  if (!capture) return { ok: false, mismatch: 'PARCEL_UNKNOWN' };

  const nowT = nowMs ?? capture.simTimeMs;
  // Arrival state: the capture's own reading (1:1 with the parcel front Z
  // in the story); later "now" falls back to the keyframe interpolation.
  const nowEnc =
    nowMs === undefined
      ? capture.encoderSpanMm[0]
      : parcelFrontZAt(manifest.keyframes, nowT);
  const parcel = { ...replayParcelAt(manifest, nowT), frontZMm: nowEnc };
  const now = { simTimeMs: nowT, encoderMm: nowEnc };
  const obsRef = { parcelId: obs.parcelId, labelInstanceId: obs.labelInstanceId };

  if (capture.kind === 'LINE_SCAN') {
    return associateLineStrip(
      {
        simTimeMs: capture.simTimeMs,
        encoderStartMm: capture.encoderSpanMm[0],
        encoderEndMm: capture.encoderSpanMm[1],
      },
      parcel,
      [parcel],
      SCAN_PLANE_Z_MM,
      now,
      windows,
    );
  }
  return associateObservation(
    obsRef,
    {
      cameraId: capture.sensorId,
      simTimeMs: capture.simTimeMs,
      encoderPositionMm: capture.encoderSpanMm[0],
    },
    parcel,
    now,
    windows,
  );
}

/** One rendered observation row (all data for a step-7 row). */
export interface Step7ObservationRow {
  observation: ReplayObservation;
  capture: CaptureRecord;
  /** Verdict computed live from the pipeline rules (never stored). */
  association: AssociationResult;
}

/**
 * Every observation of the story parcel, in manifest order, joined with
 * its capture and a LIVE association verdict. Failed decodes are rows too
 * (they carry explicit reasons and a verdict — never a fabricated value).
 */
export function observationRowsAt(
  manifest: ReplayManifest,
): Step7ObservationRow[] {
  return manifest.observations.flatMap((obs) => {
    const capture = manifest.captures.find((c) => c.captureId === obs.captureId);
    if (!capture) return [];
    return [
      {
        observation: obs,
        capture,
        association: associateReplayObservation(manifest, obs),
      },
    ];
  });
}

/* ------------------------------------------------------------------ */
/* 3D: observation cards travel from their sensor to the parcel.       */
/* ------------------------------------------------------------------ */

/** Station z (m) of the line-scan section. */
const LINE_SCAN_Z_M = 0.25;

/** Sensor anchor (station metres) a card departs from. */
function sensorAnchorM(sensorId: string): [number, number, number] {
  if (sensorId === 'ls-top') return [0, 0.9, LINE_SCAN_Z_M];
  if (sensorId === 'ls-bottom') return [0, -0.2, LINE_SCAN_Z_M];
  const side = sensorId as keyof typeof SIDE_CAM_POSE;
  if (side in SIDE_CAM_POSE) {
    // Same ring as the step-5 highlight: centred at (0, ·, 0.7), radius
    // 0.55, azimuth 0° on the +z (travel) side.
    const { azimuthDeg, low } = SIDE_CAM_POSE[side];
    const th = (azimuthDeg * Math.PI) / 180;
    const r = 0.55;
    return [r * Math.sin(th), low ? 0.62 : 0.38, 0.7 + r * Math.cos(th)];
  }
  return [0, 0.5, LINE_SCAN_Z_M];
}

export interface ObservationFlight {
  observationId: string;
  sensorId: string;
  /** Decode status drives the card colour (green vs amber). */
  decoded: boolean;
  /** Departure point (station metres). */
  from: [number, number, number];
  /** 0 = at the sensor, 1 = arrived at the parcel. */
  progress: number;
}

/**
 * Flight plan during step 7 (null outside the step): cards leave their
 * sensor in observation order with a stagger and arrive in a small
 * cluster in front of the parcel. Pure function of story time — the
 * re-rendering clock animates it.
 */
export function observationFlightsAt(
  manifest: ReplayManifest,
  tMs: number,
): ObservationFlight[] | null {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, tMs);
  const step = manifest.steps[idx];
  if (step.step !== 7) return null;
  const frac = Math.min(1, Math.max(0, (tMs - step.tStartMs) / (step.tEndMs - step.tStartMs)));
  return manifest.observations.map((obs, i) => {
    const start = 0.08 + i * 0.2;
    const dur = 0.32;
    const raw = Math.min(1, Math.max(0, (frac - start) / dur));
    const progress = raw * raw * (3 - 2 * raw); // smoothstep ease
    const capture = manifest.captures.find((c) => c.captureId === obs.captureId);
    return {
      observationId: obs.observationId,
      sensorId: capture?.sensorId ?? '',
      decoded: obs.decoded,
      from: sensorAnchorM(capture?.sensorId ?? ''),
      progress,
    };
  });
}

/**
 * 3D highlight: the observation cards in flight. Pure function of
 * (manifest, timeMs, parcel front z) — the shared replay clock animates
 * it via re-render (same pattern as the other step highlights).
 */
export function ObservationTravelHighlight({
  manifest,
  timeMs,
  parcelFrontZMm,
}: {
  manifest: ReplayManifest;
  timeMs: number;
  parcelFrontZMm: number;
}) {
  const flights = observationFlightsAt(manifest, timeMs);
  if (!flights) return null;
  const parcelZ = parcelFrontZMm / 1000;
  return (
    <group name="observation-travel" userData={{ flights: flights.length }}>
      {flights.map((f, i) => {
        // Arrival cluster: just in front of the parcel, staggered in y so
        // the cards stay visible as a small fan.
        const target: [number, number, number] = [
          0,
          0.25 + i * 0.09,
          parcelZ - 0.18,
        ];
        const x = f.from[0] + (target[0] - f.from[0]) * f.progress;
        const y = f.from[1] + (target[1] - f.from[1]) * f.progress;
        const z = f.from[2] + (target[2] - f.from[2]) * f.progress;
        return (
          <mesh key={f.observationId} position={[x, y, z]} userData={{ card: f.observationId }}>
            <boxGeometry args={[0.1, 0.055, 0.012]} />
            <meshBasicMaterial color={f.decoded ? '#7ee787' : '#e3a008'} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Right panel: the observation table.                                 */
/* ------------------------------------------------------------------ */

/** Human-readable time/encoder span of a capture. */
export function captureSpanText(capture: CaptureRecord): string {
  const s = (capture.encoderSpanMm[0] === capture.encoderSpanMm[1]
    ? capture.encoderSpanMm[0]
    : `${capture.encoderSpanMm[0]}–${capture.encoderSpanMm[1]}`) + ' mm';
  return `t ${(capture.simTimeMs / 1000).toFixed(1)} s · enc ${s}`;
}

export function Step7Association({
  manifest,
  timeMs,
}: {
  manifest: ReplayManifest;
  timeMs: number;
}) {
  const idx = stepIndexAt(manifest.steps, manifest.durationMs, timeMs);
  if (manifest.steps[idx].step !== 7) {
    return (
      <div className="step7-assoc" data-testid="step7-no-capture">
        Read assignment happens in step 7 — the observations travel to the
        parcel and are matched against its time/position window.
      </div>
    );
  }
  const rows = observationRowsAt(manifest);
  return (
    <div className="step7-assoc" data-testid="step7-assoc">
      <p className="step7-caption">
        Every pixel-decoded observation is checked against the parcel's
        time/position window with the production association rules —
        position first, time as the staleness check.
      </p>
      <div className="step7-table" role="table" aria-label="Observations">
        <div className="step7-head" role="row">
          <span>sensor</span>
          <span>time / encoder</span>
          <span>candidate</span>
          <span>value</span>
          <span>association</span>
        </div>
        {rows.map(({ observation: obs, capture, association }) => (
          <div
            key={obs.observationId}
            className={`step7-row${association.ok ? '' : ' step7-row-rejected'}`}
            role="row"
            data-testid={`obs-row-${obs.observationId}`}
            data-accepted={association.ok ? 'true' : 'false'}
          >
            <span data-testid="obs-sensor">{capture.sensorId}</span>
            <span data-testid="obs-span">{captureSpanText(capture)}</span>
            <span data-testid="obs-candidate">
              {capture.candidate
                ? `${capture.candidate.labelInstanceId} (${capture.candidate.source})`
                : '—'}
            </span>
            <span
              data-testid="obs-value"
              data-decoded={obs.decoded ? 'true' : 'false'}
            >
              {obs.decoded ? (
                obs.decodedPayload
              ) : (
                <span className="step7-no-read" data-testid="obs-no-read">
                  no read: {obs.reasons.join(', ')}
                </span>
              )}
            </span>
            <span
              data-testid="obs-verdict"
              data-ok={association.ok ? 'true' : 'false'}
            >
              {association.ok
                ? 'accepted'
                : `rejected — ${association.mismatch}`}
            </span>
          </div>
        ))}
      </div>
      <p className="step7-note">
        Duplicates of the same physical label collapse in the next step —
        here every read is shown individually.
      </p>
    </div>
  );
}

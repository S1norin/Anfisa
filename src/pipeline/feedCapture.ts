/**
 * Shared capture-feed glue (t11): run one CAMERA_CAPTURED domain event
 * through the observation engine + parcel pipeline and return the
 * audit-level observations + per-frame stats.
 *
 * Both processing paths use exactly this function so the headless driver
 * (ProcessRun) and the live store (SimStore) decode identically (NFR-006):
 * capture and decode share the same domain step — zero queueing delay.
 *
 * The decoder never reads ground truth beyond the instance payload of the
 * attributed parcel (§7 note): the engine measures true geometry, the
 * seeded quality model decides, the decoder just echoes the frame content.
 */

import type { RunObservationMeta } from '../metrics/runRecord';
import { observeLabels } from '../observation/observationEngine';
import type { SimConfig } from '../domain/config';
import type { CameraState, ParcelState } from '../domain/types';
import { decodeObservation } from './decoder';
import type { ParcelPipeline, ProcessedFrameStats } from './pipeline';

export interface FeedCaptureInput {
  cameraId: string;
  simTimeMs: number;
  encoderMm: number;
  candidateParcelIds: string[];
  config: SimConfig;
  parcels: Map<string, ParcelState>;
  cameraState: CameraState;
  /** Belt speed for the motion-blur model (SIM-004). */
  speedMmPerSec: number;
  /** Defaults to `${cameraId}@${simTimeMs}` (run-record convention). */
  frameId?: string;
}

export interface FeedCaptureOutput {
  observations: RunObservationMeta[];
  stats: ProcessedFrameStats;
}

const EMPTY_STATS = (frameId: string): ProcessedFrameStats => ({
  frameId,
  observations: 0,
  decoded: 0,
  mismatches: 0,
});

/** Feed one captured frame through engine → decode → associate → aggregate. */
export function feedCaptureEvent(
  input: FeedCaptureInput,
  pipeline: ParcelPipeline,
): FeedCaptureOutput {
  const frameId = input.frameId ?? `${input.cameraId}@${input.simTimeMs}`;
  const rig = input.config.cameraRigs.find((r) => r.id === input.cameraId);
  if (!rig) return { observations: [], stats: EMPTY_STATS(frameId) };
  // Area-scan frame path; line-scan strips arrive via their own events (t6).
  if (rig.kind !== 'AREA_SCAN') return { observations: [], stats: EMPTY_STATS(frameId) };

  const candidates = input.candidateParcelIds
    .map((id) => input.parcels.get(id))
    .filter((p): p is ParcelState => p !== undefined);
  const allParcels = [...input.parcels.values()];

  const labels = observeLabels(
    rig,
    input.cameraState,
    candidates,
    allParcels,
    { simTimeMs: input.simTimeMs, speedMmPerSec: input.speedMmPerSec },
    input.config,
  );

  const observations: RunObservationMeta[] = [];
  for (const obs of labels) {
    const parcel = candidates.find((p) => p.parcelId === obs.parcelId);
    const specLabel = parcel?.spec.labels.find(
      (l) => l.labelInstanceId === obs.labelInstanceId,
    );
    const decode = decodeObservation(obs, {
      labelInstanceId: obs.labelInstanceId,
      payload: specLabel?.payload ?? '',
    });
    observations.push({
      frameId,
      cameraId: input.cameraId,
      simTimeMs: input.simTimeMs,
      parcelId: obs.parcelId,
      labelInstanceId: obs.labelInstanceId,
      face: obs.face,
      material: parcel?.spec.material ?? 'KRAFT',
      rotationDeg: specLabel?.rotationDeg ?? 0,
      ppm: obs.pixelsPerModule,
      incidenceDeg: obs.incidenceDeg,
      confidence: obs.confidence,
      qualityPassed: obs.qualityPassed,
      decoded: decode.decoded,
      reasons: obs.reasons,
    });
  }

  const stats = pipeline.processFrame(
    {
      frameId,
      cameraId: input.cameraId,
      cameraState: input.cameraState,
      simTimeMs: input.simTimeMs,
      encoderPositionMm: input.encoderMm,
      candidateParcelIds: input.candidateParcelIds,
      labels,
    },
    { simTimeMs: input.simTimeMs, encoderMm: input.encoderMm },
    allParcels,
  );

  return { observations, stats };
}

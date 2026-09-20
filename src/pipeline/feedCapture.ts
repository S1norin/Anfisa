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
import { expectedLineCount } from '../capture/lineScanGeometry';
import { stationDeckOccludesBottomStrip } from '../observation/occlusion';
import {
  DEFAULT_LINE_FOV_MARGIN_MM,
  observeLineScanStrip,
  type LineScanStripStatus,
} from '../observation/lineScanObservation';
import type { LineScanAbortReason } from '../capture/lineScanner';

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
  return feedAcquisition({ ...input, kind: 'AREA_FRAME' }, pipeline);
}

/**
 * One closed line-scan strip (t6): the bounded t4 event payload — session
 * attribution + encoder interval — plus the same run context the area
 * path carries.
 */
export interface FeedLineStripInput {
  kind: 'LINE_STRIP';
  cameraId: string;
  simTimeMs: number;
  encoderMm: number;
  /** Parcel the scan session attributed the strip to. */
  parcelId: string;
  encoderStartMm: number;
  encoderEndMm: number;
  lineCount: number;
  complete: boolean;
  abortReason?: LineScanAbortReason;
  config: SimConfig;
  parcels: Map<string, ParcelState>;
  cameraState: CameraState;
  /** Belt speed for the line-quality proxies (SIM-004). */
  speedMmPerSec: number;
}

/** Discriminated acquisition union (t6): dispatch by rig kind. */
export type FeedAcquisitionInput =
  | (FeedCaptureInput & { kind: 'AREA_FRAME' })
  | FeedLineStripInput;

/**
 * Dispatch one acquisition — area frame or line strip — through the
 * shared engine → decode → associate → aggregate path. Both consumers
 * (SimStore, ProcessRun) call exactly this so live and headless runs stay
 * byte-identical (NFR-006).
 */
export function feedAcquisition(
  input: FeedAcquisitionInput,
  pipeline: ParcelPipeline,
): FeedCaptureOutput {
  return input.kind === 'LINE_STRIP'
    ? feedLineStrip(input, pipeline)
    : feedAreaFrame(input, pipeline);
}

function feedAreaFrame(
  input: FeedCaptureInput,
  pipeline: ParcelPipeline,
): FeedCaptureOutput {
  const frameId = input.frameId ?? `${input.cameraId}@${input.simTimeMs}`;
  const rig = input.config.cameraRigs.find((r) => r.id === input.cameraId);
  if (!rig) return { observations: [], stats: EMPTY_STATS(frameId) };
  // Area-scan frame path only (strips dispatch via feedLineStrip).
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

/**
 * Feed one closed line strip (t5 observation → per-face-label expansion →
 * interval association → aggregate). A deck-occluded strip (t5 null) and
 * a retired parcel produce NO observations and NO decodes — never a
 * fabricated read.
 */
function feedLineStrip(
  input: FeedLineStripInput,
  pipeline: ParcelPipeline,
): FeedCaptureOutput {
  const frameId = `${input.cameraId}@${input.simTimeMs}`;
  const rig = input.config.cameraRigs.find((r) => r.id === input.cameraId);
  if (!rig || rig.kind !== 'LINE_SCAN') {
    return { observations: [], stats: EMPTY_STATS(frameId) };
  }
  const parcel = input.parcels.get(input.parcelId);

  let stripObs = null;
  if (parcel) {
    const travelMm = input.encoderEndMm - input.encoderStartMm;
    const strip: LineScanStripStatus = {
      encoderStartMm: input.encoderStartMm,
      encoderEndMm: input.encoderEndMm,
      lineCount: input.lineCount,
      expectedLineCount: expectedLineCount(travelMm, rig.line.encoderStepMmPerLine),
      complete: input.complete,
      ...(input.abortReason !== undefined
        ? { abortReason: input.abortReason }
        : {}),
    };
    stripObs = observeLineScanStrip({
      rig,
      parcel,
      strip,
      simTimeMs: input.simTimeMs,
      beltSpeedMmPerSec: input.speedMmPerSec,
      xDimensionMm: input.config.barcode.xDimensionMm,
      beltWidthMm: input.config.belt.widthMm,
      coverageMarginMm: DEFAULT_LINE_FOV_MARGIN_MM,
      deckOccluded:
        rig.role === 'BOTTOM'
          ? stationDeckOccludesBottomStrip(input.config, parcel)
          : false,
      cameraFault:
        input.cameraState === 'FAULT' || input.cameraState === 'OFFLINE',
      thresholds: input.config.quality,
      seed: input.config.seed,
    });
  }

  const stats = pipeline.processLineStrip(
    {
      frameId,
      cameraId: input.cameraId,
      simTimeMs: input.simTimeMs,
      encoderStartMm: input.encoderStartMm,
      encoderEndMm: input.encoderEndMm,
      scanPlaneZMm: rig.line.scanPlaneZMm,
      parcelId: input.parcelId,
      face: rig.role === 'BOTTOM' ? 'BOTTOM' : 'TOP',
      observation: stripObs,
    },
    { simTimeMs: input.simTimeMs, encoderMm: input.encoderMm },
    input.parcels.values(),
  );

  const observations: RunObservationMeta[] = [];
  if (parcel && stripObs) {
    for (const label of parcel.spec.labels) {
      if (label.face !== stripObs.face) continue;
      observations.push({
        frameId,
        cameraId: input.cameraId,
        simTimeMs: input.simTimeMs,
        parcelId: parcel.parcelId,
        labelInstanceId: label.labelInstanceId,
        face: stripObs.face,
        material: parcel.spec.material,
        rotationDeg: label.rotationDeg,
        ppm: stripObs.effectivePpm,
        incidenceDeg: 0,
        confidence: stripObs.quality.quality,
        qualityPassed: stripObs.quality.passed,
        decoded: stripObs.decodable,
        reasons: stripObs.reasons,
        // Line-scan audit fields (t7, additive — area rows stay legacy).
        acquisitionKind: 'LINE_SCAN' as const,
        lineCount: stripObs.lineCount,
        expectedLineCount: stripObs.expectedLineCount,
        encoderStartMm: stripObs.encoderStartMm,
        encoderEndMm: stripObs.encoderEndMm,
        complete: stripObs.complete,
        ...(stripObs.abortReason !== undefined
          ? { abortReason: stripObs.abortReason }
          : {}),
      });
    }
  }

  return { observations, stats };
}
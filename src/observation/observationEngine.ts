/**
 * Observation engine (PIPE-001..PIPE-005): assembles one LabelObservation
 * per candidate label per camera from the pure geometric modules:
 *
 *   projection  → corners, coverage, distance, incidence (PIPE-001)
 *   occlusion   → ray test against other parcels (PIPE-001)
 *   blur        → §8.1 corner-based image-plane motion (PIPE-003)
 *   quality     → components, gates, seeded boundary (PIPE-004)
 *   reasons     → canonical reason codes (PIPE-005)
 *
 * PPM comes from the PHYSICAL sensor model (fx from focal + film gauge),
 * never the preview resolution (PIPE-002). Ground-truth payloads are NOT
 * read here — the decoder (pipeline) decides success from the synthetic
 * observation only; the engine may use true geometry to MEASURE conditions.
 */

import {
  sensorIntrinsics,
  toCameraSpace,
} from '../domain/camera';
import type { SimConfig } from '../domain/config';
import type {
  CameraConfig,
  CameraState,
  LabelObservation,
  ParcelState,
} from '../domain/types';
import { defocusPx, parcelGlareIndex } from '../capture/imageFormation';
import { labelMotionBlurPx } from './blur';
import { labelOccludedMm, stationDeckOccludesBottom } from './occlusion';
import { contrastProxy, evaluateQuality } from './quality';
import type { ReasonInput } from './reasons';
import { labelCenterWorldMm, projectLabelMm } from './projection';

/** Per-frame measurement context (from the capture scheduler). */
export interface ObserveContext {
  simTimeMs: number;
  speedMmPerSec: number;
  /** Per-frame illumination multiplier (flicker), 1 = steady. */
  illuminationFactor?: number;
}

/**
 * LabelObservation + the quality-model decision the decode stage consumes
 * (PIPE-006). `qualityPassed`/`qualityGates` are engine-internal; the
 * contract fields above them are what the audit record stores.
 */
export interface LabelObservationResult extends LabelObservation {
  qualityPassed: boolean;
  qualityGates: string[];
}

/**
 * Observe every label of every candidate parcel from one rig.
 *
 * @param rig          camera configuration (physical sensor model)
 * @param cameraState  runtime camera state (FAULT/OFFLINE → hard gate)
 * @param candidates   parcels in the trigger zone at capture time
 * @param allParcels   ALL parcels (occlusion rays test against the rest)
 * @param ctx          time + belt speed (+ optional flicker factor)
 * @param config       sim config (quality thresholds, barcode x-dimension, seed)
 */
export function observeLabels(
  rig: CameraConfig,
  cameraState: CameraState,
  candidates: ParcelState[],
  allParcels: ParcelState[],
  ctx: ObserveContext,
  config: SimConfig,
): LabelObservationResult[] {
  const intr = sensorIntrinsics(rig.sensor);
  const camPos = rig.pose.positionMm;
  const cameraFault = cameraState === 'FAULT' || cameraState === 'OFFLINE';
  const contrast = contrastProxy(rig, ctx.illuminationFactor ?? 1);
  const out: LabelObservationResult[] = [];

  for (const parcel of candidates) {
    const glare = parcelGlareIndex(rig, parcel);
    for (const label of parcel.spec.labels) {
      const proj = projectLabelMm(rig, label, parcel);
      const centre = labelCenterWorldMm(label, parcel);
      const camZ = toCameraSpace(centre, rig)[2];

      // PIPE-002: projected module width from the physical sensor.
      const ppm = camZ > 0 ? (intr.fx / camZ) * config.barcode.xDimensionMm : 0;
      const blur = labelMotionBlurPx(rig, label, parcel, ctx.speedMmPerSec);
      const focus = camZ > 0 ? defocusPx(rig, camZ) : 0;
      const occluded =
        labelOccludedMm(camPos, centre, parcel, allParcels) ||
        stationDeckOccludesBottom(config, label.face, centre[2]);

      const input: ReasonInput = {
        inFov: proj.inFov,
        frontFacing: proj.frontFacing,
        occluded,
        cameraFault,
        coverage: proj.coverage,
        ppm,
        incidenceDeg: proj.incidenceDeg,
        blurPx: blur,
        focusPx: focus,
        contrast,
        glare,
        damage: label.damage,
      };

      // Deterministic boundary roll: same run + camera + label + time.
      const seedKey = `${config.seed}:${rig.id}:${label.labelInstanceId}:${ctx.simTimeMs}`;
      const q = evaluateQuality(input, config.quality, seedKey);

      out.push({
        parcelId: parcel.parcelId,
        labelInstanceId: label.labelInstanceId,
        face: label.face,
        projectedCornersPx: proj.inFov
          ? proj.cornersPx.map((c) => [c!.xPx, c!.yPx] as [number, number])
          : [],
        coverage: proj.coverage,
        distanceMm: proj.distanceMm,
        incidenceDeg: proj.incidenceDeg,
        pixelsPerModule: ppm,
        blurPx: blur,
        qualityComponents: q.components,
        confidence: q.quality,
        reasons: q.reasons,
        qualityPassed: q.passed,
        qualityGates: q.gateFailures,
      });
    }
  }
  return out;
}

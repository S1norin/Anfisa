/**
 * Deterministic label generation (PAR-002..PAR-005, PAR-007).
 *
 * Pure functions over (config, rng, id generator, payload history) so the
 * whole thing is testable headless and reproducible from a seed.
 *
 * Rules:
 *  - PAR-002: 1..N labels per parcel (config range, default 1-4).
 *  - PAR-003: any of the six faces; faces may repeat (multiple per face).
 *  - PAR-004: random face-local position + in-plane rotation; the label is
 *    always kept fully inside the face (rotation-aware clamping). Partial/
 *    overhanging labels belong to explicit damage scenarios (later issues).
 *  - PAR-005: `labelInstanceId` is the identity of a physical label; the
 *    `payload` is what it encodes. Repeated payloads (config
 *    `duplicatePayloadChance`) are legitimate and stay separate instances.
 *  - PAR-007: each label rolls a print-damage value (IMG-010) from the
 *    same rng stream — mostly clean, occasionally scuffed.
 */

import { labelDamageValue } from './labelDamage';
import type { SimConfig } from './config';
import { degToRad } from './units';
import type { Rng } from './rng';
import type { Face, LabelInstance, ParcelSpec } from './types';

export const ALL_FACES: readonly Face[] = [
  'FRONT',
  'REAR',
  'LEFT',
  'RIGHT',
  'TOP',
  'BOTTOM',
] as const;

/**
 * Face extents in face-local coordinates [u, v] (mm):
 *   FRONT/REAR — u across belt (width), v up (height)
 *   LEFT/RIGHT — u along travel (length), v up (height)
 *   TOP/BOTTOM — u across belt (width), v along travel (length)
 */
export function faceExtents(face: Face, spec: ParcelSpec): [number, number] {
  switch (face) {
    case 'FRONT':
    case 'REAR':
      return [spec.widthMm, spec.heightMm];
    case 'LEFT':
    case 'RIGHT':
      return [spec.lengthMm, spec.heightMm];
    case 'TOP':
    case 'BOTTOM':
      return [spec.widthMm, spec.lengthMm];
  }
}

/** `KTY-` + N digits by default (PAR-007: prefix/length are config). */
export function makePayload(cfg: SimConfig, rng: Rng): string {
  let digits = '';
  for (let i = 0; i < cfg.barcode.payloadDigits; i++) {
    digits += String(rng.int(0, 9));
  }
  return cfg.barcode.payloadPrefix + digits;
}

export interface LabelPlacement {
  localOffsetMm: [number, number];
  rotationDeg: number;
}

/**
 * PAR-004: sample a position + rotation such that the rotated label
 * rectangle always fits the face. The rotation-aware half-extents are
 *   extU = |cos|·hw + |sin|·hv,  extV = |sin|·hw + |cos|·hv
 * and the centre is clamped to the shrunken face.
 */
export function randomLabelPlacement(
  face: Face,
  spec: ParcelSpec,
  labelWidthMm: number,
  labelHeightMm: number,
  rng: Rng,
): LabelPlacement {
  const rotationDeg = rng.range(0, 360);
  const rad = degToRad(rotationDeg);
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const hw = labelWidthMm / 2;
  const hh = labelHeightMm / 2;
  const extU = c * hw + s * hh;
  const extV = s * hw + c * hh;

  const [faceU, faceV] = faceExtents(face, spec);
  const maxU = Math.max(0, faceU / 2 - extU);
  const maxV = Math.max(0, faceV / 2 - extV);

  return {
    localOffsetMm: [rng.range(-maxU, maxU), rng.range(-maxV, maxV)],
    rotationDeg,
  };
}

export interface LabelGenContext {
  cfg: SimConfig;
  spec: ParcelSpec;
  rng: Rng;
  nextLabelId: () => string;
  /**
   * Payloads of labels created EARLIER in this run (shared, mutated).
   * Enables the PAR-005 repeated-payload case across parcels.
   */
  payloadHistory: string[];
}

/** Generate 1..N labels for one parcel (PAR-002..PAR-005). */
export function generateLabels(ctx: LabelGenContext): LabelInstance[] {
  const { cfg, spec, rng, nextLabelId, payloadHistory } = ctx;
  const count = rng.int(cfg.parcel.labelCountMin, cfg.parcel.labelCountMax);
  const labels: LabelInstance[] = [];

  for (let i = 0; i < count; i++) {
    let payload: string;
    const canDuplicate =
      cfg.barcode.duplicatePayloadChance > 0 && payloadHistory.length > 0;
    if (canDuplicate && rng.next() < cfg.barcode.duplicatePayloadChance) {
      payload = rng.pick(payloadHistory);
    } else {
      payload = makePayload(cfg, rng);
      payloadHistory.push(payload);
    }

    const face = ALL_FACES[rng.int(0, ALL_FACES.length - 1)];
    const placement = randomLabelPlacement(
      face,
      spec,
      cfg.barcode.labelWidthMm,
      cfg.barcode.labelHeightMm,
      rng,
    );

    const labelInstanceId = nextLabelId();
    labels.push({
      labelInstanceId,
      payload,
      face,
      localOffsetMm: placement.localOffsetMm,
      rotationDeg: placement.rotationDeg,
      widthMm: cfg.barcode.labelWidthMm,
      heightMm: cfg.barcode.labelHeightMm,
      damage: labelDamageValue(rng, cfg.parcel.labelDamageChance),
    });
  }

  return labels;
}

/**
 * PAR-004 invariant: every corner of the rotated label rectangle lies
 * inside (or on the edge of) the face. Used by tests and by the render
 * layer as a debug assertion.
 */
export function labelFitsFace(label: LabelInstance, spec: ParcelSpec): boolean {
  const [faceU, faceV] = faceExtents(label.face, spec);
  const rad = degToRad(label.rotationDeg);
  const hw = label.widthMm / 2;
  const hh = label.heightMm / 2;
  const [ou, ov] = label.localOffsetMm;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: [number, number][] = [
    [hw, hh],
    [hw, -hh],
    [-hw, -hh],
    [-hw, hh],
  ].map(([x, y]) => [ou + x * cos - y * sin, ov + x * sin + y * cos]);
  return corners.every(
    ([u, v]) =>
      u >= -faceU / 2 - 1e-9 &&
      u <= faceU / 2 + 1e-9 &&
      v >= -faceV / 2 - 1e-9 &&
      v <= faceV / 2 + 1e-9,
  );
}

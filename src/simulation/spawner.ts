/**
 * Seeded parcel spawner (PAR-001..PAR-005).
 *
 * Builds a full ParcelSpec from config + run state: dimensions, lateral
 * offset, yaw, material, tape strip (PAR-001) and 1..N Code 128 labels
 * with face-local placement (PAR-002..PAR-005). All randomness flows
 * through the run's seeded Rng, so the same seed reproduces the same
 * parcels and labels.
 */

import type { SimConfig } from '../domain/config';
import { generateLabels } from '../domain/label';
import type { Rng } from '../domain/rng';
import type { LabelInstance, ParcelSpec } from '../domain/types';
import type { SimState } from './state';

export function buildParcelSpec(state: SimState): ParcelSpec {
  const p = state.config.parcel;
  const spec: ParcelSpec = {
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    lengthMm: p.lengthMm,
    lateralOffsetMm: p.lateralOffsetMm,
    yawDeg: p.yawDeg,
    material: p.material,
    tape: state.rng.next() < p.tapeChance,
    labels: [],
  };
  spec.labels = generateLabels({
    cfg: state.config,
    spec,
    rng: state.rng,
    nextLabelId: state.labelIds,
    payloadHistory: state.payloadHistory,
  });
  return spec;
}

/**
 * Convenience for tests/tooling: generate labels for a standalone spec
 * without a full simulation.
 */
export function generateLabelsForSpec(
  cfg: SimConfig,
  spec: ParcelSpec,
  rng: Rng,
  nextLabelId: () => string,
  payloadHistory: string[],
): LabelInstance[] {
  return generateLabels({ cfg, spec, rng, nextLabelId, payloadHistory });
}

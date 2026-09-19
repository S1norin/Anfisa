/**
 * Print-defect ASSIGNMENT (IMG-010, PAR-007): the analytic side.
 *
 * `labelDamageValue` is the damage 0..1 assigned at label spawn; it feeds
 * the quality model's damage component (issue #8). The VISIBLE side
 * (baking scratches/creases into the label texture) lives in
 * `scene/labelDamage.ts` — presentation only.
 *
 * Deterministic: same (rng stream, chance) → same damage (NFR-002).
 */

import type { Rng } from './rng';

/**
 * Damage assigned at label spawn: mostly clean; damaged labels get
 * 0.15..0.65 damage. `chance` = fraction of labels that are damaged.
 */
export function labelDamageValue(rng: Rng, chance = 0.15): number {
  if (rng.next() >= chance) return 0;
  return Math.round(rng.range(0.15, 0.65) * 1000) / 1000;
}

/** Deterministic per-label seed from its instance id (stable across runs). */
export function labelSeedFor(labelInstanceId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < labelInstanceId.length; i++) {
    h ^= labelInstanceId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

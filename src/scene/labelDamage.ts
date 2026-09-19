/**
 * Print defects (IMG-010, PAR-007) — the VISIBLE side.
 *
 * `bakeLabelDamage` paints seeded scratches, crease bands and scuffs onto
 * the label canvas before it becomes a texture. The ANALYTIC side (damage
 * value + deterministic per-label seed) lives in `domain/labelDamage.ts`
 * and is re-exported here so texture callers have one import.
 *
 * Fully deterministic: the same (labelInstanceId, damage) always bakes
 * the same pixels. No Math.random anywhere in the pipeline (NFR-002).
 */

import { createRng } from '../domain/rng';

export { labelDamageValue, labelSeedFor } from '../domain/labelDamage';

/**
 * Paint seeded print defects onto a label canvas.
 * damage 0 → no-op. damage 1 → a badly scuffed label (bars still mostly
 * visible — this is print damage, not a missing label).
 */
export function bakeLabelDamage(
  canvas: HTMLCanvasElement,
  damage: number,
  seed: number,
): void {
  if (damage <= 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return; // headless-safe: tests can pass stubs
  const rng = createRng((seed >>> 0) || 1);
  const w = canvas.width;
  const h = canvas.height;

  const scratches = Math.round(damage * 8);
  for (let i = 0; i < scratches; i++) {
    const x0 = rng.range(0, w);
    const y0 = rng.range(0, h);
    const len = rng.range(w * 0.08, w * 0.35);
    const ang = rng.range(-0.9, 0.9);
    ctx.strokeStyle = `rgba(90, 90, 90, ${rng.range(0.15, 0.45)})`;
    ctx.lineWidth = Math.max(1, w * 0.002);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
    ctx.stroke();
  }

  const creases = Math.round(damage * 3);
  for (let i = 0; i < creases; i++) {
    const y = rng.range(h * 0.15, h * 0.85);
    const bandH = Math.max(2, h * 0.04);
    const grad = ctx.createLinearGradient(0, y - bandH, 0, y + bandH);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, `rgba(0,0,0,${rng.range(0.2, 0.4)})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, w, bandH * 2);
  }

  const scuffs = Math.round(damage * 4);
  for (let i = 0; i < scuffs; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const r = rng.range(w * 0.02, w * 0.06);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(60,60,60,${rng.range(0.25, 0.5)})`);
    grad.addColorStop(1, 'rgba(60,60,60,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

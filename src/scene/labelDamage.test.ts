/**
 * Print defects (IMG-010, PAR-007): deterministic damage assignment +
 * deterministic canvas bake.
 *
 * The bake is tested through a stub 2D context (headless): the assertions
 * are on the CALL SEQUENCE (same seed → same pixels), not on pixels.
 */

import { createRng } from '../domain/rng';
import { labelDamageValue, labelSeedFor, bakeLabelDamage } from './labelDamage';

/** Records every drawing call in order. */
function stubCanvas() {
  const calls: string[] = [];
  const gradient = {
    addColorStop: (o: number, c: string) => calls.push(`stop@${o}:${c}`),
  };
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo:${x.toPrecision(6)},${y.toPrecision(6)}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo:${x.toPrecision(6)},${y.toPrecision(6)}`),
    stroke: () => calls.push('stroke'),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`fillRect:${x.toPrecision(4)},${y.toPrecision(4)},${w.toPrecision(4)},${h.toPrecision(4)}`),
    arc: (x: number, y: number, r: number) => calls.push(`arc:${x.toPrecision(6)},${y.toPrecision(6)},${r.toPrecision(6)}`),
    fill: () => calls.push('fill'),
    createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => {
      calls.push(`linGrad:${x0},${y0},${x1},${y1}`);
      return gradient;
    },
    createRadialGradient: (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => {
      calls.push(`radGrad:${x0},${y0},${r0},${x1},${y1},${r1}`);
      return gradient;
    },
  };
  const canvas = {
    width: 640,
    height: 120,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('labelDamageValue (PAR-007)', () => {
  it('assigns 0 when chance is 0', () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) expect(labelDamageValue(rng, 0)).toBe(0);
  });

  it('assigns 0.15..0.65 when every label is damaged', () => {
    const rng = createRng(2);
    for (let i = 0; i < 50; i++) {
      const d = labelDamageValue(rng, 1);
      expect(d).toBeGreaterThanOrEqual(0.15);
      expect(d).toBeLessThanOrEqual(0.65);
    }
  });

  it('is mostly clean at the default 15% chance, and deterministic per seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    const seriesA: number[] = [];
    const seriesB: number[] = [];
    for (let i = 0; i < 100; i++) {
      const da = labelDamageValue(a);
      const db = labelDamageValue(b);
      seriesA.push(da);
      seriesB.push(db);
      expect(da).toBe(db);
    }
    const clean = seriesA.filter((d) => d === 0).length;
    expect(clean).toBeGreaterThan(70);
    expect(clean).toBeLessThan(100);
  });
});

describe('labelSeedFor', () => {
  it('is deterministic and distinct per label id', () => {
    expect(labelSeedFor('L-0001')).toBe(labelSeedFor('L-0001'));
    expect(labelSeedFor('L-0001')).not.toBe(labelSeedFor('L-0002'));
  });
});

describe('bakeLabelDamage (IMG-010 visual side)', () => {
  it('does nothing for damage 0', () => {
    const { canvas, calls } = stubCanvas();
    bakeLabelDamage(canvas, 0, 42);
    expect(calls).toHaveLength(0);
  });

  it('bakes scratches, creases and scuffs proportionally to damage', () => {
    const { canvas, calls } = stubCanvas();
    bakeLabelDamage(canvas, 0.5, 42);
    expect(calls.filter((c) => c === 'stroke').length).toBe(4); // round(0.5*8)
    expect(calls.filter((c) => c.startsWith('linGrad')).length).toBe(2); // round(0.5*3)→2 (banker-ish? no: Math.round(1.5)=2)
    expect(calls.filter((c) => c.startsWith('radGrad')).length).toBe(2); // round(0.5*4)
  });

  it('is deterministic: same seed → identical call sequence; different seed → different', () => {
    const a = stubCanvas();
    const b = stubCanvas();
    const c = stubCanvas();
    bakeLabelDamage(a.canvas, 0.5, 42);
    bakeLabelDamage(b.canvas, 0.5, 42);
    bakeLabelDamage(c.canvas, 0.5, 43);
    expect(b.calls).toEqual(a.calls);
    expect(c.calls).not.toEqual(a.calls);
  });

  it('is a no-op without a 2D context (headless-safe)', () => {
    const canvas = { width: 10, height: 10, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => bakeLabelDamage(canvas, 0.5, 1)).not.toThrow();
  });
});

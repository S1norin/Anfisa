import { createIdGenerator, createRng } from './rng';

describe('deterministic RNG', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(2026);
    const b = createRng(2026);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('stays within [0,1) and int() within inclusive bounds', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const r = createRng(7);
    for (let i = 0; i < 200; i++) {
      const n = r.int(3, 9);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});

describe('ID generator', () => {
  it('produces stable sequential IDs', () => {
    const id = createIdGenerator('P');
    expect([id(), id(), id()]).toEqual(['P-0000', 'P-0001', 'P-0002']);
  });

  it('is independent per generator', () => {
    const a = createIdGenerator('P');
    const b = createIdGenerator('L');
    a();
    expect([a(), b()]).toEqual(['P-0001', 'L-0000']);
  });
});

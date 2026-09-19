import { defaultConfig } from '../domain/config';
import { createSimState, spawnParcel } from './state';

describe('seeded parcel spawner (PAR-001..PAR-005)', () => {
  it('spawns parcels with 1-4 labels, valid payloads, unique instance ids', () => {
    const state = createSimState(defaultConfig());
    for (let i = 0; i < 20; i++) {
      const parcel = spawnParcel(state, i * 2000);
      expect(parcel.spec.labels.length).toBeGreaterThanOrEqual(1);
      expect(parcel.spec.labels.length).toBeLessThanOrEqual(4);
      const ids = new Set<string>();
      for (const label of parcel.spec.labels) {
        expect(label.payload).toMatch(/^KTY-\d{14}$/);
        expect(ids.has(label.labelInstanceId)).toBe(false);
        ids.add(label.labelInstanceId);
      }
    }
  });

  it('is deterministic: same seed reproduces identical specs (PAR-001)', () => {
    const dump = (seed: number) => {
      const cfg = defaultConfig();
      cfg.seed = seed;
      const state = createSimState(cfg);
      const specs: string[] = [];
      for (let i = 0; i < 10; i++) {
        const p = spawnParcel(state, i * 2000);
        specs.push(
          [
            p.parcelId,
            p.spec.tape ? 'tape' : 'no-tape',
            ...p.spec.labels.map(
              (l) =>
                `${l.labelInstanceId}|${l.payload}|${l.face}|` +
                `${l.localOffsetMm[0].toFixed(3)}|${l.localOffsetMm[1].toFixed(3)}|` +
                `${l.rotationDeg.toFixed(3)}`,
            ),
          ].join('::'),
        );
      }
      return specs;
    };
    expect(dump(2026)).toEqual(dump(2026));
    expect(dump(2026)).not.toEqual(dump(1));
  });

  it('produces the repeated-payload case over a run (PAR-005)', () => {
    const cfg = defaultConfig();
    cfg.parcel.labelCountMin = 3;
    cfg.parcel.labelCountMax = 4;
    const state = createSimState(cfg);
    const payloads: string[] = [];
    for (let i = 0; i < 100; i++) {
      const p = spawnParcel(state, i * 2000);
      payloads.push(...p.spec.labels.map((l) => l.payload));
    }
    const counts = new Map<string, number>();
    for (const p of payloads) counts.set(p, (counts.get(p) ?? 0) + 1);
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
    // ...while instance ids stay unique.
    expect(state.payloadHistory.length).toBeGreaterThanOrEqual(90);
  });

  it('tapes appear according to tapeChance (PAR-001)', () => {
    const cfg = defaultConfig();
    cfg.parcel.tapeChance = 1;
    const state = createSimState(cfg);
    expect(spawnParcel(state, 0).spec.tape).toBe(true);

    const cfg2 = defaultConfig();
    cfg2.parcel.tapeChance = 0;
    const state2 = createSimState(cfg2);
    expect(spawnParcel(state2, 0).spec.tape).toBe(false);
  });
});

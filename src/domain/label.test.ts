import { defaultConfig } from './config';
import {
  ALL_FACES,
  faceExtents,
  generateLabels,
  labelFitsFace,
  makePayload,
  randomLabelPlacement,
} from './label';
import { createIdGenerator, createRng } from './rng';
import type { ParcelSpec } from './types';

function makeSpec(overrides: Partial<ParcelSpec> = {}): ParcelSpec {
  const p = defaultConfig().parcel;
  return {
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    lengthMm: p.lengthMm,
    lateralOffsetMm: 0,
    yawDeg: 0,
    material: 'KRAFT',
    tape: false,
    labels: [],
    ...overrides,
  };
}

describe('makePayload', () => {
  it('produces prefix + N digits', () => {
    const rng = createRng(42);
    const payload = makePayload(defaultConfig(), rng);
    expect(payload).toMatch(/^KTY-\d{14}$/);
  });

  it('respects configured prefix and digit count', () => {
    const cfg = defaultConfig();
    cfg.barcode.payloadPrefix = 'AB-';
    cfg.barcode.payloadDigits = 6;
    expect(makePayload(cfg, createRng(1))).toMatch(/^AB-\d{6}$/);
  });
});

describe('face extents', () => {
  it('maps each face to the correct (u, v) extents', () => {
    const spec = makeSpec(); // 400 x, 400 y, 600 z
    expect(faceExtents('FRONT', spec)).toEqual([400, 400]);
    expect(faceExtents('REAR', spec)).toEqual([400, 400]);
    expect(faceExtents('LEFT', spec)).toEqual([600, 400]);
    expect(faceExtents('RIGHT', spec)).toEqual([600, 400]);
    expect(faceExtents('TOP', spec)).toEqual([400, 600]);
    expect(faceExtents('BOTTOM', spec)).toEqual([400, 600]);
  });
});

describe('randomLabelPlacement (PAR-004)', () => {
  it('keeps the rotated label fully inside the face', () => {
    const cfg = defaultConfig();
    const spec = makeSpec();
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const face = ALL_FACES[rng.int(0, ALL_FACES.length - 1)];
      const placement = randomLabelPlacement(
        face,
        spec,
        cfg.barcode.labelWidthMm,
        cfg.barcode.labelHeightMm,
        rng,
      );
      const label = {
        labelInstanceId: `T-${i}`,
        payload: 'KTY-0',
        face,
        localOffsetMm: placement.localOffsetMm,
        rotationDeg: placement.rotationDeg,
        widthMm: cfg.barcode.labelWidthMm,
        heightMm: cfg.barcode.labelHeightMm,
        damage: 0,
      };
      expect(labelFitsFace(label, spec)).toBe(true);
    }
  });

  it('keeps the label inside even on a narrow face with a large label', () => {
    const spec = makeSpec({ heightMm: 120 });
    const rng = createRng(99);
    for (let i = 0; i < 300; i++) {
      const placement = randomLabelPlacement(
        'TOP',
        spec,
        100,
        50,
        rng,
      );
      const label = {
        labelInstanceId: 'T',
        payload: 'KTY-0',
        face: 'TOP' as const,
        localOffsetMm: placement.localOffsetMm,
        rotationDeg: placement.rotationDeg,
        widthMm: 100,
        heightMm: 50,
        damage: 0,
      };
      expect(labelFitsFace(label, spec)).toBe(true);
    }
  });

  it('samples full in-plane rotation [0, 360)', () => {
    const rng = createRng(3);
    const rots = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const p = randomLabelPlacement('FRONT', makeSpec(), 78, 25, rng);
      expect(p.rotationDeg).toBeGreaterThanOrEqual(0);
      expect(p.rotationDeg).toBeLessThan(360);
      rots.add(Math.round(p.rotationDeg));
    }
    expect(rots.size).toBeGreaterThan(50); // genuinely varied
  });
});

describe('generateLabels (PAR-002..PAR-005)', () => {
  it('creates 1..4 labels on valid faces', () => {
    const cfg = defaultConfig();
    const rng = createRng(2026);
    const spec = makeSpec();
    const labels = generateLabels({
      cfg,
      spec,
      rng,
      nextLabelId: createIdGenerator('L'),
      payloadHistory: [],
    });
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels.length).toBeLessThanOrEqual(4);
    for (const label of labels) {
      expect(ALL_FACES).toContain(label.face);
      expect(label.labelInstanceId).toMatch(/^L-\d{4}$/);
      expect(label.payload).toMatch(/^KTY-\d{14}$/);
      expect(labelFitsFace(label, spec)).toBe(true);
    }
  });

  it('allows multiple labels on the same face', () => {
    const cfg = defaultConfig();
    cfg.parcel.labelCountMin = 4;
    cfg.parcel.labelCountMax = 4;
    cfg.barcode.duplicatePayloadChance = 0;
    const spec = makeSpec({ widthMm: 400, heightMm: 400, lengthMm: 600 });
    let seenRepeats = false;
    for (let trial = 0; trial < 50 && !seenRepeats; trial++) {
      const r = createRng(1000 + trial);
      const labels = generateLabels({
        cfg,
        spec,
        rng: r,
        nextLabelId: createIdGenerator('L'),
        payloadHistory: [],
      });
      const counts = new Map<string, number>();
      for (const l of labels) counts.set(l.face, (counts.get(l.face) ?? 0) + 1);
      if ([...counts.values()].some((n) => n > 1)) seenRepeats = true;
    }
    expect(seenRepeats).toBe(true);
  });

  it('keeps labelInstanceId unique even for repeated payloads (PAR-005)', () => {
    const cfg = defaultConfig();
    cfg.barcode.duplicatePayloadChance = 1; // force the repeated-payload case
    cfg.parcel.labelCountMin = 4;
    cfg.parcel.labelCountMax = 4;
    const rng = createRng(11);
    const spec = makeSpec();
    const labels = generateLabels({
      cfg,
      spec,
      rng,
      nextLabelId: createIdGenerator('L'),
      payloadHistory: ['KTY-11111111111111'],
    });
    const ids = labels.map((l) => l.labelInstanceId);
    expect(new Set(ids).size).toBe(ids.length);
    const payloads = labels.map((l) => l.payload);
    expect(new Set(payloads).size).toBeLessThan(payloads.length); // repeats exist
  });

  it('appends new payloads to the shared history', () => {
    const cfg = defaultConfig();
    cfg.barcode.duplicatePayloadChance = 0;
    const rng = createRng(12);
    const spec = makeSpec();
    const history: string[] = [];
    const labels = generateLabels({
      cfg,
      spec,
      rng,
      nextLabelId: createIdGenerator('L'),
      payloadHistory: history,
    });
    expect(history.length).toBe(labels.length);
    expect(history).toEqual(labels.map((l) => l.payload));
  });

  it('is deterministic: same seed => same labels', () => {
    const run = (): string[] => {
      const cfg = defaultConfig();
      const rng = createRng(2026);
      const labels = generateLabels({
        cfg,
        spec: makeSpec(),
        rng,
        nextLabelId: createIdGenerator('L'),
        payloadHistory: [],
      });
      return labels.map((l) => `${l.labelInstanceId}:${l.payload}:${l.face}`);
    };
    expect(run()).toEqual(run());
  });
});

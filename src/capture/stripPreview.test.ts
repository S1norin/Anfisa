/**
 * Encoder-mapped strip preview (t9): row axis = encoder axis, artifacts
 * from the rig's imageEffects, deterministic per (seed, rig, parcel,
 * encoder interval). Display-only — never feeds decode (NFR-002).
 */

import { describe, expect, it } from 'vitest';
import { defaultLineScanRig } from '../domain/camera';
import type { LineScanCameraConfig } from '../domain/types';
import { buildStripTexture, type StripPreviewInput } from './stripPreview';

const PLANE_Z = 1100;

function rig(over: Partial<LineScanCameraConfig['imageEffects']> = {}): LineScanCameraConfig {
  const r = defaultLineScanRig('LS-001', 'TOP', [0, 900, PLANE_Z], [0, 1, 0, 0], PLANE_Z);
  return { ...r, imageEffects: { ...r.imageEffects, ...over } };
}

/** 500 mm travel at 0.1 mm/line = 5000 encoder lines (rows). */
const BASE: StripPreviewInput = {
  rig: rig(),
  parcelId: 'P-0001',
  simTimeMs: 5000,
  strip: {
    encoderStartMm: 1300,
    encoderEndMm: 1800,
    lineCount: 5000,
    expectedLineCount: 5000,
    complete: true,
  },
  beltSpeedMmPerSec: 1500,
  seed: 42,
};

/** Mean R channel of one row (step 4 = RGBA stride). */
function rowMean(data: Uint8ClampedArray, widthPx: number, row: number): number {
  let sum = 0;
  for (let c = 0; c < widthPx; c++) sum += data[row * widthPx * 4 + c * 4];
  return sum / widthPx;
}

describe('buildStripTexture', () => {
  it('maps rows to the encoder axis: one row per encoder line', () => {
    const t = buildStripTexture(BASE);
    expect(t.heightPx).toBe(5000); // 500 mm / 0.1 mm per line
    expect(t.widthPx).toBe(320); // 8192 px/line downsampled
    expect(t.data.length).toBe(320 * 5000 * 4);
    expect(t.encoderStartMm).toBe(1300);
    expect(t.encoderEndMm).toBe(1800);
  });

  it('is deterministic and sensitive to the encoder start position', () => {
    const a = buildStripTexture(BASE);
    const b = buildStripTexture(BASE);
    expect(b.data.length).toBe(a.data.length);
    expect(b.missingLineRows).toEqual(a.missingLineRows);
    // Same build → identical rows (sampled: first/middle/last).
    for (const r of [0, 2500, 4999]) {
      expect(b.data.subarray(r * 320 * 4, (r + 1) * 320 * 4)).toEqual(
        a.data.subarray(r * 320 * 4, (r + 1) * 320 * 4),
      );
    }
    // Shifted encoder interval → different mapping → different texture.
    const c = buildStripTexture({
      ...BASE,
      strip: { ...BASE.strip, encoderStartMm: 1350, encoderEndMm: 1850 },
    });
    expect(
      c.data.subarray(0, 320 * 4),
    ).not.toEqual(a.data.subarray(0, 320 * 4));
  });

  it('drops missing lines as black rows (missingLineChance = 1)', () => {
    const t = buildStripTexture({
      ...BASE,
      rig: rig({ missingLineChance: 1 }),
      beltSpeedMmPerSec: 0,
    });
    expect(t.missingLineRows.length).toBe(t.heightPx);
    for (let r = 0; r < t.heightPx; r++) {
      expect(rowMean(t.data, t.widthPx, r)).toBe(0);
    }
  });

  it('renders rows beyond lineCount as the not-acquired tail', () => {
    const t = buildStripTexture({
      ...BASE,
      rig: rig(),
      beltSpeedMmPerSec: 0,
      strip: {
        encoderStartMm: 1300,
        encoderEndMm: 1800,
        lineCount: 1000,
        expectedLineCount: 5000,
        complete: false,
      },
    });
    // Acquired rows carry the face pattern (mean well above the tail).
    expect(rowMean(t.data, t.widthPx, 0)).toBeGreaterThan(100);
    // Tail rows: the dark not-acquired value.
    expect(rowMean(t.data, t.widthPx, 1000)).toBeCloseTo(26, 0);
    expect(rowMean(t.data, t.widthPx, 4999)).toBeCloseTo(26, 0);
    expect(t.complete).toBe(false);
  });

  it('bands: row brightness modulates periodically along the encoder axis', () => {
    const t = buildStripTexture({
      ...BASE,
      rig: rig({ banding: 0.4 }),
      beltSpeedMmPerSec: 0,
    });
    let min = Infinity;
    let max = -Infinity;
    for (let r = 0; r < 120; r++) {
      const m = rowMean(t.data, t.widthPx, r);
      min = Math.min(min, m);
      max = Math.max(max, m);
    }
    expect(max - min).toBeGreaterThan(0.08 * 255);
    // Zero banding: every row identical (flat reconstruction).
    const flat = buildStripTexture({ ...BASE, beltSpeedMmPerSec: 0 });
    for (let r = 1; r < 5; r++) {
      expect(
        Array.from(
          flat.data.subarray(r * 320 * 4, (r + 1) * 320 * 4),
        ),
      ).toEqual(Array.from(flat.data.subarray(0, 320 * 4)));
    }
  });

  it('jitter: encoder mapping wobble shifts the bar pattern per row', () => {
    const clean = buildStripTexture({ ...BASE, beltSpeedMmPerSec: 0 });
    const jittered = buildStripTexture({
      ...BASE,
      rig: rig({ jitter: 0.3 }),
      beltSpeedMmPerSec: 0,
    });
    expect(jittered.data).not.toEqual(clean.data);
  });

  it('smears with belt motion during the line exposure (SIM-004)', () => {
    const static_ = buildStripTexture({ ...BASE, beltSpeedMmPerSec: 0 });
    const moving = buildStripTexture({ ...BASE, beltSpeedMmPerSec: 1500 });
    // Blur widens the bar edges: fewer hard 0/255 extremes, shifted means.
    expect(moving.data).not.toEqual(static_.data);
    const extreme = (d: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 16 || d[i] > 239) n++;
      }
      return n;
    };
    expect(extreme(moving.data)).toBeLessThan(extreme(static_.data));
  });
});

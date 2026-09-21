/**
 * Line-scan strip view (t3-1, subtask s2): the strip appends rows in
 * encoder order and stays synchronized to the encoder ruler (the marker
 * relates the current row to the box position).
 *
 *  - hiwStripSync: pure encoder→row mapping (monotonic, clamped);
 *  - hiwStripSyncAt: story pose × capture span (playback state);
 *  - StripView component: row counter, canvas rows, scanline and ruler
 *    marker all track the parcel front Z;
 *  - PlaybackStore scrub sequence: rows grow monotonically with the clock
 *    and saturate at the capture span end.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildSuccessManifest, buildNoReadManifest } from './fixtures';
import { PlaybackStore } from './playbackStore';
import {
  StripView,
  hiwStripSync,
  hiwStripSyncAt,
  lineScanPayload,
  type StripViewProps,
} from './stripView';
import { HIW_STRIP } from '../../capture/stripPreview';

const manifest = buildSuccessManifest();
const lineCapture = manifest.captures.find((c) => c.kind === 'LINE_SCAN')!;
const [z0, z1] = lineCapture.encoderSpanMm;
const TOTAL = HIW_STRIP.rows;

function viewProps(frontZMm: number): StripViewProps {
  return { capture: lineCapture, payload: lineScanPayload(manifest, lineCapture), frontZMm };
}

describe('hiwStripSync (encoder → row mapping)', () => {
  it('clamps before the span start: no rows', () => {
    expect(hiwStripSync(z0, z1, -150)).toEqual({
      totalRows: TOTAL,
      visibleRows: 0,
      encoderPct: 0,
      spanStartMm: z0,
      spanEndMm: z1,
    });
  });

  it('is zero exactly at the span start', () => {
    expect(hiwStripSync(z0, z1, z0).visibleRows).toBe(0);
  });

  it('maps the span middle to half the rows', () => {
    const mid = (z0 + z1) / 2;
    const sync = hiwStripSync(z0, z1, mid);
    expect(sync.encoderPct).toBe(50);
    expect(sync.visibleRows).toBe(Math.floor(TOTAL / 2));
  });

  it('saturates at the span end and stays saturated after', () => {
    expect(hiwStripSync(z0, z1, z1)).toEqual({
      totalRows: TOTAL,
      visibleRows: TOTAL,
      encoderPct: 100,
      spanStartMm: z0,
      spanEndMm: z1,
    });
    expect(hiwStripSync(z0, z1, 450).visibleRows).toBe(TOTAL);
    expect(hiwStripSync(z0, z1, 1400).visibleRows).toBe(TOTAL);
  });

  it('is monotonically non-decreasing across the whole travel', () => {
    let prev = 0;
    for (let z = -150; z <= 1400; z += 5) {
      const rows = hiwStripSync(z0, z1, z).visibleRows;
      expect(rows).toBeGreaterThanOrEqual(prev);
      prev = rows;
    }
  });
});

describe('hiwStripSyncAt (playback state: story pose × span)', () => {
  // Keyframes: t=7500 front=-40 → t=15000 front=320 (linear).
  it('no rows while the parcel is short of the span start', () => {
    expect(hiwStripSyncAt(manifest, lineCapture, 7500).visibleRows).toBe(0);
    expect(hiwStripSyncAt(manifest, lineCapture, 12000).visibleRows).toBe(0);
  });

  it('rows begin only once the front is past the span start (z0=200)', () => {
    // front(t) = -40 + (t-7500)/7500*360 → front=200 at t = 12500.
    // One row needs 120/560 ≈ 0.214 mm ≈ 4.5 ms, so the first row lands at ~12505.
    expect(hiwStripSyncAt(manifest, lineCapture, 12500).visibleRows).toBe(0);
    expect(hiwStripSyncAt(manifest, lineCapture, 12504).visibleRows).toBe(0);
    expect(hiwStripSyncAt(manifest, lineCapture, 12505).visibleRows).toBe(1);
  });

  it('half the rows at the span midpoint (t=13750, front=260)', () => {
    const sync = hiwStripSyncAt(manifest, lineCapture, 13750);
    expect(sync.visibleRows).toBe(Math.floor(TOTAL / 2));
    expect(sync.encoderPct).toBeCloseTo(50, 6);
  });

  it('all rows once the front reaches the span end (t=15000, front=320)', () => {
    const sync = hiwStripSyncAt(manifest, lineCapture, 15000);
    expect(sync.visibleRows).toBe(TOTAL);
    expect(sync.encoderPct).toBe(100);
  });

  it('stays complete for the rest of the story', () => {
    expect(hiwStripSyncAt(manifest, lineCapture, 30000).visibleRows).toBe(TOTAL);
    expect(hiwStripSyncAt(manifest, lineCapture, 60000).visibleRows).toBe(TOTAL);
  });

  it('marker fraction equals row fraction at every time (sync)', () => {
    for (const t of [7500, 10000, 12500, 13750, 15000, 22500, 60000]) {
      const sync = hiwStripSyncAt(manifest, lineCapture, t);
      const rowFrac = sync.visibleRows / sync.totalRows;
      // One-row quantization tolerance: the marker leads by at most a row.
      expect(Math.abs(rowFrac - sync.encoderPct / 100)).toBeLessThanOrEqual(
        1 / sync.totalRows + 1e-9,
      );
    }
  });
});

describe('lineScanPayload', () => {
  it('resolves the TOP-face label for the top line scan', () => {
    expect(lineScanPayload(manifest, lineCapture)).toBe('A1F4-2026-0001');
  });

  it('resolves the no-read fixture top payload', () => {
    const noRead = buildNoReadManifest();
    const cap = noRead.captures.find((c) => c.kind === 'LINE_SCAN')!;
    expect(lineScanPayload(noRead, cap)).toBe('C5M2-2026-0077');
  });
});

describe('StripView component (encoder-synced row append)', () => {
  it('shows zero rows and a marker at 0% before the span', () => {
    render(<StripView {...viewProps(-40)} />);
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent('0 / 560 rows');
    expect(screen.getByTestId('hiw-strip-canvas')).toHaveAttribute(
      'data-visible-rows',
      '0',
    );
    expect(screen.getByTestId('hiw-strip-ruler-marker').style.left).toBe('0%');
    expect(screen.getByTestId('hiw-strip-encoder-value')).toHaveTextContent('-40 mm');
  });

  it('appends rows and tracks the marker at the current row', () => {
    render(<StripView {...viewProps(260)} />);
    const half = Math.floor(TOTAL / 2);
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent(
      `${half} / 560 rows`,
    );
    expect(screen.getByTestId('hiw-strip-canvas')).toHaveAttribute(
      'data-visible-rows',
      String(half),
    );
    // Scanline and ruler marker at the same encoder fraction.
    expect(screen.getByTestId('hiw-strip-scanline').style.top).toBe('50%');
    expect(screen.getByTestId('hiw-strip-ruler-marker').style.left).toBe('50%');
    expect(screen.getByTestId('hiw-strip-encoder-value')).toHaveTextContent('260 mm');
  });

  it('hides the scanline once the strip is complete', () => {
    render(<StripView {...viewProps(320)} />);
    expect(screen.getByTestId('hiw-strip-rows')).toHaveTextContent('560 / 560 rows');
    expect(screen.queryByTestId('hiw-strip-scanline')).toBeNull();
    expect(screen.getByTestId('hiw-strip-ruler-marker').style.left).toBe('100%');
  });

  it('rows grow with the encoder (append-only, encoder order)', () => {
    const { rerender } = render(<StripView {...viewProps(200)} />);
    const counts: number[] = [];
    for (const z of [200, 230, 260, 290, 320]) {
      rerender(<StripView {...viewProps(z)} />);
      const n = Number(screen.getByTestId('hiw-strip-canvas').getAttribute('data-visible-rows'));
      counts.push(n);
    }
    // front: 200, 230, 260, 290, 320 → fractions 0, .25, .5, .75, 1
    expect(counts).toEqual([0, 140, 280, 420, TOTAL]);
  });
});

describe('PlaybackStore scrub sequence (playback state test)', () => {
  it('rows are monotonic with the clock and saturate at the span end', () => {
    const store = new PlaybackStore({ fixtureId: 'success' });
    store.setDuration(manifest.durationMs);
    const samples = [7500, 10000, 12500, 13125, 13750, 14375, 15000, 30000, 60000];
    const rows = samples.map((t) => {
      store.scrub(t);
      return hiwStripSyncAt(manifest, lineCapture, store.getState().timeMs);
    });
    // front(t): -40, 80, 200, 230, 260, 290, 320, 450, 1400
    expect(rows.map((r) => r.visibleRows)).toEqual([0, 0, 0, 140, 280, 420, 560, 560, 560]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].visibleRows).toBeGreaterThanOrEqual(rows[i - 1].visibleRows);
    }
    // Ruler marker tracks the same fraction at each sample.
    for (const r of rows) {
      const rowFrac = r.visibleRows / r.totalRows;
      expect(Math.abs(rowFrac - r.encoderPct / 100)).toBeLessThanOrEqual(
        1 / r.totalRows + 1e-9,
      );
    }
  });

  it('restart rewinds the strip to zero rows', () => {
    const store = new PlaybackStore({ fixtureId: 'success' });
    store.setDuration(manifest.durationMs);
    store.scrub(15000);
    expect(hiwStripSyncAt(manifest, lineCapture, store.getState().timeMs).visibleRows).toBe(
      TOTAL,
    );
    store.restart();
    expect(hiwStripSyncAt(manifest, lineCapture, store.getState().timeMs).visibleRows).toBe(
      0,
    );
  });
});

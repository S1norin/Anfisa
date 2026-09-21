/**
 * Step 8: combine, deduplicate, final result (t6-2) tests.
 *
 *  - AC1: result card lists unique barcode values with source sensors;
 *    duplicate reads (same physical label, two cameras) shown as merged.
 *  - AC2: a failed read produces no value and its reasons are visible.
 *  - AC3: final values are EXACTLY the accepted pixel-decoded
 *    observations from step 7 (set equality).
 *  - AC4: technical values behind a details control; status + timestamp
 *    visible.
 *
 * All aggregation/status math comes from the production pipeline
 * (aggregation.ts + finalize.ts) — these tests prove the wiring.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildNoReadManifest, buildSuccessManifest } from './fixtures';
import { observationRowsAt } from './step7Association';
import {
  Step8Result,
  buildStep8Result,
  statusTextOf,
  valueRowsOf,
} from './step8Result';

const manifest = buildSuccessManifest();
const noRead = buildNoReadManifest();
const T_STEP8 = 56_000;

describe('buildStep8Result (production aggregation + status policy)', () => {
  it('success: OK, two labels, L-side reads merged across both cameras', () => {
    const r = buildStep8Result(manifest);
    expect(r.status).toBe('OK');
    expect(r.expectedLabels).toBe(2);
    expect(r.decodedLabels).toBe(2);
    expect(r.observationCount).toBe(3);
    const side = r.labels.find((l) => l.labelInstanceId === 'L-side')!;
    expect(side.decoded).toBe(true);
    expect(side.decodedCount).toBe(2);
    expect(side.observationCount).toBe(2);
    expect(side.cameras).toEqual(['cam-side-1', 'cam-side-2']);
  });

  it('no-read: PARTIAL — the side label carries reasons, never a value', () => {
    const r = buildStep8Result(noRead);
    expect(r.status).toBe('PARTIAL');
    const side = r.labels.find((l) => l.labelInstanceId === 'L-side')!;
    expect(side.decoded).toBe(false);
    expect(side.decodedPayload).toBeUndefined();
    expect(side.reasons).toContain('QUALITY:GLARE');
    expect(side.reasons).toContain('QUALITY:LOW_CONTRAST');
    expect(side.cameras).toEqual(['cam-side-1', 'cam-side-2']);
    expect(r.decodedLabels).toBe(1);
  });
});

describe('AC3: final values = accepted step-7 pixel decodes (set equality)', () => {
  it('success fixture', () => {
    const r = buildStep8Result(manifest);
    const step7Values = new Set(
      observationRowsAt(manifest)
        .filter((row) => row.association.ok && row.observation.decoded)
        .map((row) => row.observation.decodedPayload!),
    );
    expect(new Set(r.payloads)).toEqual(step7Values);
    expect([...r.payloads].sort()).toEqual(['A1F4-2026-0001', 'B7K9-2026-0042']);
  });

  it('no-read fixture: only the top value survives', () => {
    const r = buildStep8Result(noRead);
    const step7Values = new Set(
      observationRowsAt(noRead)
        .filter((row) => row.association.ok && row.observation.decoded)
        .map((row) => row.observation.decodedPayload!),
    );
    expect(new Set(r.payloads)).toEqual(step7Values);
    expect(r.payloads).toEqual(['C5M2-2026-0077']);
  });
});

describe('valueRowsOf (unique payloads with source sensors + merged count)', () => {
  it('success: two unique payloads; B7K9 merged from two sensors', () => {
    const rows = valueRowsOf(buildStep8Result(manifest));
    expect(rows.map((r) => r.payload)).toEqual([
      'A1F4-2026-0001',
      'B7K9-2026-0042',
    ]);
    const b = rows.find((r) => r.payload === 'B7K9-2026-0042')!;
    expect(b.sensors).toEqual(['cam-side-1', 'cam-side-2']);
    expect(b.readCount).toBe(2);
    const a = rows.find((r) => r.payload === 'A1F4-2026-0001')!;
    expect(a.sensors).toEqual(['ls-top']);
    expect(a.readCount).toBe(1);
  });
});

describe('Step8Result (DOM: the result card)', () => {
  it('AC1: unique values with source sensors; duplicates shown as merged', () => {
    render(<Step8Result manifest={manifest} timeMs={T_STEP8} />);
    expect(screen.getByTestId('step8-result')).toHaveAttribute(
      'data-status',
      'OK',
    );
    const b = screen.getByTestId('step8-value-B7K9-2026-0042');
    expect(b.querySelector('[data-testid=step8-value-text]')?.textContent).toBe(
      'B7K9-2026-0042',
    );
    expect(b.querySelector('[data-testid=step8-value-sensors]')?.textContent).toBe(
      'cam-side-1, cam-side-2',
    );
    expect(b.querySelector('[data-testid=step8-value-merged]')?.textContent).toBe(
      '2 reads merged',
    );
    const a = screen.getByTestId('step8-value-A1F4-2026-0001');
    expect(a.querySelector('[data-testid=step8-value-merged]')?.textContent).toBe(
      '1 read',
    );
  });

  it('AC2: failed reads show the explicit reasons and never a value', () => {
    render(<Step8Result manifest={noRead} timeMs={T_STEP8} />);
    // Only the top payload is a value row.
    expect(screen.getByTestId('step8-value-C5M2-2026-0077')).toBeTruthy();
    const side = screen.getByTestId('step8-label-L-side');
    expect(side).toHaveAttribute('data-decoded', 'false');
    expect(side.querySelector('[data-testid=step8-noread]')?.textContent).toBe(
      'no read: QUALITY:GLARE, QUALITY:LOW_CONTRAST',
    );
    // The side label row shows its source reads, not a payload.
    expect(side.querySelector('[data-testid=step8-label-sensors]')?.textContent).toBe(
      'cam-side-1, cam-side-2',
    );
    expect(side.textContent).not.toContain('C5M2-2026-0077');
  });

  it('AC4: status + timestamp visible; technical values behind a details control', () => {
    render(<Step8Result manifest={manifest} timeMs={T_STEP8} />);
    expect(screen.getByTestId('step8-status').textContent).toBe(
      statusTextOf(buildStep8Result(manifest)),
    );
    expect(screen.getByTestId('step8-timestamp').textContent).toBe('t 60.0 s');
    const details = screen.getByTestId('step8-details');
    expect(details.tagName).toBe('DETAILS');
    expect(details.hasAttribute('open')).toBe(false);
    // Technical content exists inside the control.
    const tech = screen.getByTestId('step8-tech');
    expect(tech.textContent).toContain('L-side');
    expect(tech.textContent).toContain('2/2 decoded');
  });

  it('shows the empty state outside step 8', () => {
    render(<Step8Result manifest={manifest} timeMs={48_000} />);
    expect(screen.getByTestId('step8-empty')).toBeTruthy();
    expect(screen.queryByTestId('step8-result')).toBeNull();
  });
});

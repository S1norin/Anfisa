/**
 * Step 7: assign reads to the parcel (t6-1) tests.
 *
 *  - AC2: the association verdicts are computed with the EXISTING pipeline
 *    rules (src/pipeline/association.ts) fed by the pixel-decoded
 *    observations — both fixtures associate fully; the window rules still
 *    fire (ghost instance, stale frame, non-overlapping strip interval).
 *  - AC1: the observation rows list every observation with sensor,
 *    time/encoder span, candidate, decoded value / no-read reasons, and
 *    the accept/reject verdict.
 *  - AC3 (scene state): the flight plan — cards depart from the sensor
 *    anchors in observation order, arrive in a cluster, and only exist
 *    during step 7.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildNoReadManifest, buildSuccessManifest } from './fixtures';
import {
  SIDE_CAM_ORDER,
} from './step5SideCameras';
import {
  Step7Association,
  associateReplayObservation,
  captureSpanText,
  observationFlightsAt,
  observationRowsAt,
  replayParcelAt,
  SCAN_PLANE_Z_MM,
  STORY_PARCEL_LENGTH_MM,
} from './step7Association';

const manifest = buildSuccessManifest();
const noRead = buildNoReadManifest();

/** Step 7 spans [45000, 52500) ms of the 60 s story. */
const T_STEP7 = 48_750;

describe('replayParcelAt (minimal ParcelState for the rules)', () => {
  it('carries the manifest label instances and the story box length', () => {
    const p = replayParcelAt(manifest, T_STEP7);
    expect(p.parcelId).toBe(manifest.parcel.parcelId);
    expect(p.spec.lengthMm).toBe(STORY_PARCEL_LENGTH_MM);
    expect(p.spec.labels.map((l) => l.labelInstanceId)).toEqual([
      'L-top',
      'L-side',
    ]);
    expect(p.phase).toBe('ENTERED');
  });
});

describe('AC2: association runs the existing pipeline rules', () => {
  it('success fixture: every observation is accepted at frame arrival', () => {
    for (const obs of manifest.observations) {
      expect(associateReplayObservation(manifest, obs), obs.observationId)
        .toEqual({ ok: true });
    }
  });

  it('no-read fixture: failed decodes are still associated (verdict ≠ decode)', () => {
    for (const obs of noRead.observations) {
      expect(associateReplayObservation(noRead, obs), obs.observationId)
        .toEqual({ ok: true });
    }
  });

  it('line-strip rule: the top strip interval overlaps the parcel interval exactly once', () => {
    // The strip spans encoder 200–320 mm; the parcel (350 mm) is mid-cross
    // at frame time, so its scan-plane travel interval overlaps the strip.
    const obs = manifest.observations[0]; // cap-ls-top-01
    expect(associateReplayObservation(manifest, obs)).toEqual({ ok: true });
    // A strip span BEFORE the parcel reaches the plane overlaps zero
    // intervals → the rule refuses to fabricate a read.
    const late = { ...manifest, captures: manifest.captures.map((c) =>
      c.captureId === obs.captureId
        ? { ...c, encoderSpanMm: [0, 50] as [number, number] }
        : c,
    )};
    expect(associateReplayObservation(late, obs)).toEqual({
      ok: false,
      mismatch: 'INTERVAL_AMBIGUOUS',
    });
  });

  it('window rules still fire: stale area frame → POSITION_OUT_OF_WINDOW', () => {
    const obs = manifest.observations[1]; // cam-side-1, captured at 780 mm
    // "now" at step 7 start: the parcel has travelled ~170 mm past the
    // capture → beyond the 50 mm position window.
    const r = associateReplayObservation(manifest, obs, 45_000);
    expect(r.ok).toBe(false);
    expect(r.mismatch).toBe('POSITION_OUT_OF_WINDOW');
  });

  it('ghost instance → GHOST_INSTANCE (never silently dropped)', () => {
    const obs = {
      ...manifest.observations[1],
      labelInstanceId: 'L-missing',
    };
    expect(associateReplayObservation(manifest, obs)).toEqual({
      ok: false,
      mismatch: 'GHOST_INSTANCE',
    });
  });

  it('scan plane constant matches the story keyframes (~250 mm)', () => {
    expect(SCAN_PLANE_Z_MM).toBe(250);
  });
});

describe('AC1: observationRowsAt (every observation, joined, live verdict)', () => {
  it('lists all observations of the success fixture with live verdicts', () => {
    const rows = observationRowsAt(manifest);
    expect(rows.map((r) => r.observation.observationId)).toEqual([
      'obs-1',
      'obs-2',
      'obs-3',
    ]);
    for (const row of rows) {
      expect(row.association).toEqual({ ok: true });
      expect(row.capture).toBeTruthy();
      expect(row.observation.parcelId).toBe(manifest.parcel.parcelId);
    }
  });

  it('no-read fixture: failed rows carry reasons, never a payload', () => {
    const rows = observationRowsAt(noRead);
    const glare = rows.find((r) => r.capture.sensorId === 'cam-side-1')!;
    expect(glare.observation.decoded).toBe(false);
    expect(glare.observation.decodedPayload).toBeUndefined();
    expect(glare.observation.reasons).toContain('QUALITY:GLARE');
    expect(glare.association.ok).toBe(true); // association ≠ decode
  });

  it('captureSpanText renders the time + encoder span', () => {
    const top = manifest.captures.find((c) => c.sensorId === 'ls-top')!;
    expect(captureSpanText(top)).toBe('t 12.0 s · enc 200–320 mm');
    const side = manifest.captures.find((c) => c.sensorId === 'cam-side-1')!;
    expect(captureSpanText(side)).toBe('t 35.0 s · enc 780 mm');
  });
});

describe('AC3 (scene state): observationFlightsAt (cards travel to the parcel)', () => {
  it('is null outside step 7', () => {
    expect(observationFlightsAt(manifest, 44_999)).toBeNull(); // step 6
    expect(observationFlightsAt(manifest, 52_500)).toBeNull(); // step 8
  });

  it('one flight per observation, departing from the sensor anchors', () => {
    const flights = observationFlightsAt(manifest, 45_000)!;
    expect(flights.length).toBe(3);
    // First observation is the top line scan — departs from the top reader.
    expect(flights[0].sensorId).toBe('ls-top');
    expect(flights[0].from).toEqual([0, 0.9, 0.25]);
    // Side-cam flights depart from the section-2 ring: radius 0.55 m
    // around (0, ·, 0.7) — the 0° camera sits on the +z axis of that ring.
    for (const f of flights.slice(1)) {
      expect(Math.hypot(f.from[0], f.from[2] - 0.7)).toBeCloseTo(0.55);
    }
    expect(flights.every((f) => f.progress >= 0 && f.progress <= 1)).toBe(true);
  });

  it('cards leave in observation order with a stagger and all arrive', () => {
    // Mid-step: card 0 is already in flight, cards 1 and 2 are staged.
    const early = observationFlightsAt(manifest, 47_000)!;
    expect(early[0].progress).toBeGreaterThan(0.4);
    expect(early[1].progress).toBeLessThan(early[0].progress);
    expect(early[2].progress).toBe(0);
    // Just after the stagger: all three are in flight, in order.
    const mid = observationFlightsAt(manifest, 49_000)!;
    expect(mid[0].progress).toBeGreaterThan(mid[1].progress);
    expect(mid[1].progress).toBeGreaterThan(mid[2].progress);
    const late = observationFlightsAt(manifest, 52_000)!;
    expect(late.every((f) => f.progress === 1)).toBe(true);
  });

  it('decoded cards are flagged for green colour, no-read for amber', () => {
    const flights = observationFlightsAt(manifest, T_STEP7)!;
    expect(flights.map((f) => f.decoded)).toEqual([true, true, true]);
    const nr = observationFlightsAt(noRead, T_STEP7)!;
    expect(nr.map((f) => f.decoded)).toEqual([true, false, false]);
  });

  it('side anchors match the step-5 camera ring (azimuth/height)', () => {
    // cam-side-1 (0°) sits on the +z side of the ring at the high height;
    // cam-side-2 (45°) is on the +x/+z quadrant.
    const flights = observationFlightsAt(manifest, T_STEP7)!;
    const cam1 = flights.find((f) => f.sensorId === 'cam-side-1')!;
    expect(cam1.from[0]).toBeCloseTo(0);
    expect(cam1.from[1]).toBeCloseTo(0.38);
    expect(cam1.from[2]).toBeCloseTo(1.25); // 0° → +z side of the ring
    const cam2 = flights.find((f) => f.sensorId === 'cam-side-2')!;
    expect(cam2.from[0]).toBeGreaterThan(0.3);
    expect(cam2.from[1]).toBeCloseTo(0.38);
    expect(cam2.from[2]).toBeGreaterThan(0.7);
    // Only observed sensors get cards — cam-side-6 (no label in frame) has
    // no observation, so no flight.
    expect(flights.map((f) => f.sensorId)).not.toContain('cam-side-6');
    expect(SIDE_CAM_ORDER).toContain('cam-side-6');
  });
});

describe('Step7Association (DOM: the observation table)', () => {
  it('lists every observation with sensor, span, candidate, value, verdict', () => {
    render(<Step7Association manifest={manifest} timeMs={T_STEP7} />);
    const rows = screen.getAllByTestId(/obs-row-obs-/);
    expect(rows.length).toBe(3);

    const row1 = screen.getByTestId('obs-row-obs-1');
    expect(row1).toHaveAttribute('data-accepted', 'true');
    expect(screen.getAllByTestId('obs-sensor')[0].textContent).toBe('ls-top');
    expect(screen.getAllByTestId('obs-span')[0].textContent).toBe(
      't 12.0 s · enc 200–320 mm',
    );
    expect(screen.getAllByTestId('obs-candidate')[0].textContent).toBe(
      'L-top (pixels)',
    );
    expect(screen.getAllByTestId('obs-value')[0].textContent).toBe(
      'A1F4-2026-0001',
    );
    expect(screen.getAllByTestId('obs-verdict')[0].textContent).toBe(
      'accepted',
    );
    expect(rows.map((r) => r.getAttribute('data-accepted'))).toEqual([
      'true',
      'true',
      'true',
    ]);
  });

  it('no-read fixture: failed reads show the explicit reasons and no value', () => {
    render(<Step7Association manifest={noRead} timeMs={T_STEP7} />);
    const values = screen.getAllByTestId('obs-value');
    // obs-2 (cam 1, glare) and obs-3 (cam 2, low contrast) are no-reads:
    // explicit reasons, never a payload in the value cell.
    expect(values[1].getAttribute('data-decoded')).toBe('false');
    expect(values[2].getAttribute('data-decoded')).toBe('false');
    expect(screen.getAllByTestId('obs-no-read')[0].textContent).toContain(
      'QUALITY:GLARE',
    );
    expect(screen.getAllByTestId('obs-no-read')[1].textContent).toContain(
      'QUALITY:LOW_CONTRAST',
    );
    // The top read still shows its pixel-decoded value.
    expect(values[0].textContent).toBe('C5M2-2026-0077');
    expect(values[1].textContent).not.toContain('C5M2-2026-0077');
    expect(values[2].textContent).not.toContain('C5M2-2026-0077');
    // The geometry candidate carries its source label.
    expect(screen.getAllByTestId('obs-candidate')[2].textContent).toBe(
      'L-side (geometry)',
    );
    // Association verdicts are independent of decode failures.
    expect(screen.getAllByTestId('obs-verdict').map((v) => v.textContent)).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);
  });

  it('shows the explicit empty state outside step 7', () => {
    render(<Step7Association manifest={manifest} timeMs={41_250} />);
    expect(screen.getByTestId('step7-no-capture')).toBeTruthy();
    expect(screen.queryByTestId('step7-assoc')).toBeNull();
  });
});

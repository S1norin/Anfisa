/**
 * Metrics CSV export (issue #15, t15-3, AC-10): one row per displayed
 * metric value + MET-007 breakdowns, parseable, deterministic.
 */

import { describe, expect, it } from 'vitest';
import { recommendedSixViewConfig } from '../capture/presets';
import { ProcessRun } from '../pipeline/runDriver';
import type { RunObservationMeta } from '../metrics/runRecord';
import { metricsToCsv } from './csv';

function baselineRun(): ProcessRun {
  const cfg = recommendedSixViewConfig();
  cfg.seed = 2026;
  cfg.belt.speedMmPerSec = 1000;
  cfg.parcel.labelCountMin = 1;
  cfg.parcel.labelCountMax = 4;
  cfg.parcel.material = 'KRAFT';
  cfg.parcel.tapeChance = 0;
  cfg.parcel.labelDamageChance = 0;
  const run = new ProcessRun(cfg, 20);
  run.runToCompletion();
  return run;
}

/** Minimal RFC-4180-ish parser for the 3-column layout. */
function parseCsv(text: string): Record<string, string> {
  const lines = text.trim().split('\n');
  const [section, name, ...rest] = lines[0].split(',');
  expect(section).toBe('section');
  expect(name).toBe('name');
  expect(rest.join(',')).toBe('value');
  const out: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    expect(cells).toHaveLength(3);
    out[`${cells[0]}|${cells[1]}`] = cells[2];
  }
  return out;
}

describe('metricsToCsv (AC-10)', () => {
  it('exports every displayed metric as a parseable row', () => {
    const m = baselineRun().record().metrics;
    const rows = parseCsv(metricsToCsv(m));

    expect(rows['rates|completeReadRate']).toBe('1');
    expect(rows['rates|barcodeRecall']).toBe('1');
    expect(rows['rates|barcodePrecision']).toBe('1');
    expect(rows['counts|evaluatedParcels']).toBe('20');
    expect(rows['counts|expectedInstances']).toBe(String(m.expectedInstances));
    expect(rows['counts|decodedInstances']).toBe(String(m.decodedInstances));
    expect(rows['counts|falseDecodes']).toBe('0');
    expect(rows['counts|misassociations']).toBe('0');

    for (const stage of [
      'captureToDecodeMs',
      'entryToResultMs',
      'exitToResultMs',
      'exitToAckMs',
    ] as const) {
      expect(rows[`latency|${stage}P50`]).toBe(String(m.latency[stage].p50));
      expect(rows[`latency|${stage}P95`]).toBe(String(m.latency[stage].p95));
      expect(rows[`latency|${stage}P99`]).toBe(String(m.latency[stage].p99));
      expect(rows[`latency|${stage}samples`]).toBe(String(m.latency[stage].n));
    }

    // Breakdowns: every (section, key) row carries decoded/total.
    const breakdownKeys = Object.keys(rows).filter((k) =>
      k.startsWith('breakdown:'),
    );
    expect(breakdownKeys.length).toBeGreaterThan(0);
    for (const k of breakdownKeys) {
      expect(rows[k]).toMatch(/^\d+\/\d+ decoded$/);
    }
  });

  it('is deterministic for the same run (NFR-006)', () => {
    expect(metricsToCsv(baselineRun().record().metrics)).toBe(
      metricsToCsv(baselineRun().record().metrics),
    );
  });

  it('line-scan observation rows are stable; area rows keep the legacy layout (t7)', () => {
    const run = baselineRun().record();
    const m = run.metrics;
    const areaObs = run.observations[0]; // recommendedSixView: area rigs only
    expect(areaObs).toBeDefined();
    expect(areaObs.acquisitionKind).toBeUndefined(); // legacy shape

    const lineObs: RunObservationMeta[] = [
      {
        ...areaObs,
        frameId: 'LS-TOP@10000',
        cameraId: 'LS-TOP',
        face: 'TOP',
        acquisitionKind: 'LINE_SCAN',
        lineCount: 6000,
        expectedLineCount: 6000,
        encoderStartMm: 1300,
        encoderEndMm: 1900,
        ppm: 10,
        incidenceDeg: 0,
        complete: true,
        decoded: true,
      },
      {
        ...areaObs,
        frameId: 'LS-BOT@15000',
        cameraId: 'LS-BOT',
        face: 'BOTTOM',
        acquisitionKind: 'LINE_SCAN',
        lineCount: 3000,
        expectedLineCount: 6000,
        encoderStartMm: 2000,
        encoderEndMm: 2600,
        ppm: 10,
        incidenceDeg: 0,
        complete: false,
        abortReason: 'CLOSE_SPACING',
        decoded: false,
      },
    ];

    const csv = metricsToCsv(m, [areaObs, ...lineObs]);
    const rows = parseCsv(csv);

    // Area rows unchanged: the legacy metric rows are all still there.
    const legacy = parseCsv(metricsToCsv(m));
    for (const [k, v] of Object.entries(legacy)) {
      expect(rows[k], k).toBe(v);
    }

    // Exactly one row per LINE_SCAN observation, area obs adds none.
    const obsKeys = Object.keys(rows).filter((k) => k.startsWith('observations|'));
    expect(obsKeys.sort()).toEqual(['observations|LS-BOT@15000', 'observations|LS-TOP@10000']);
    expect(rows['observations|LS-TOP@10000']).toBe(
      'kind=LINE_SCAN;face=TOP;lineCount=6000;expectedLineCount=6000;encoderStartMm=1300;encoderEndMm=1900;effectivePpm=10;complete=true;decoded=true',
    );
    expect(rows['observations|LS-BOT@15000']).toContain('complete=false');
    expect(rows['observations|LS-BOT@15000']).toContain('abortReason=CLOSE_SPACING');
    expect(rows['observations|LS-BOT@15000']).toContain('decoded=false');

    // Deterministic.
    expect(metricsToCsv(m, [areaObs, ...lineObs])).toBe(csv);
  });

  it('escapes commas, quotes, and newlines (RFC 4180)', () => {
    const m = baselineRun().record().metrics;
    const withWeird = {
      ...m,
      breakdowns: {
        ...m.breakdowns,
        camera: [
          { key: 'cam, "top"', decoded: 1, total: 2, readRate: 0.5 },
        ],
      },
    };
    const csv = metricsToCsv(withWeird);
    expect(csv).toContain('breakdown:camera,"cam, ""top""",1/2 decoded');
    // Still parses back to the original key.
    const rows = parseCsv(csv);
    expect(rows['breakdown:camera|cam, "top"']).toBe('1/2 decoded');
  });
});

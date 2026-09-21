/**
 * Metrics CSV export (issue #15, AC-10): every displayed metric value as
 * one row per (section, name, value), plus the MET-007 breakdown tables.
 * Deterministic ordering (object key order is stable for the metrics
 * shape), so the same run always produces the same CSV (NFR-006).
 */

import type { BreakdownRow } from '../metrics/breakdowns';
import type { RunMetrics } from '../metrics/metrics';
import type { RunObservationMeta } from '../metrics/runRecord';

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function row(section: string, name: string, value: string | number): string {
  return [csvEscape(section), csvEscape(name), csvEscape(String(value))].join(',');
}

/**
 * One row per displayed metric value (AC-10). When `observations` is
 * provided (t7), line-scan strip observations append one stable row each
 * under the `observations` section — area-frame observations keep the
 * legacy layout untouched (append-safe: every row is independent).
 */
export function metricsToCsv(
  metrics: RunMetrics,
  observations: readonly RunObservationMeta[] = [],
): string {
  const lines: string[] = ['section,name,value'];

  // Headline rates (MET-001..MET-004).
  lines.push(row('rates', 'completeReadRate', metrics.completeReadRate));
  lines.push(row('rates', 'barcodeRecall', metrics.barcodeRecall));
  lines.push(row('rates', 'barcodePrecision', metrics.barcodePrecision));
  lines.push(row('rates', 'duplicateRate', metrics.duplicateRate));

  // Counts.
  lines.push(row('counts', 'evaluatedParcels', metrics.evaluatedParcels));
  lines.push(row('counts', 'expectedInstances', metrics.expectedInstances));
  lines.push(row('counts', 'decodedInstances', metrics.decodedInstances));
  lines.push(row('counts', 'correctDecodes', metrics.correctDecodes));
  lines.push(row('counts', 'falseDecodes', metrics.falseDecodes));
  lines.push(row('counts', 'misassociations', metrics.misassociations));
  lines.push(row('counts', 'totalObservations', metrics.totalObservations));
  lines.push(row('counts', 'uniqueObservedInstances', metrics.uniqueObservedInstances));
  lines.push(row('counts', 'observationsCollapsed', metrics.observationsCollapsed));

  // Latency percentiles (MET-006): stage keys carry the unit (…Ms).
  const lat = metrics.latency;
  for (const stage of [
    'captureToDecodeMs',
    'entryToResultMs',
    'exitToResultMs',
    'exitToAckMs',
  ] as const) {
    const s = lat[stage];
    lines.push(row('latency', `${stage}P50`, s.p50));
    lines.push(row('latency', `${stage}P95`, s.p95));
    lines.push(row('latency', `${stage}P99`, s.p99));
    lines.push(row('latency', `${stage}samples`, s.n));
  }

  // Breakdowns (MET-007): one row per (breakdown, key).
  const breakdownSections = [
    'camera',
    'face',
    'material',
    'rotation',
    'ppm',
    'angle',
    'reason',
  ] as const;
  for (const section of breakdownSections) {
    for (const b of metrics.breakdowns[section] as BreakdownRow[]) {
      lines.push(row(`breakdown:${section}`, b.key, `${b.decoded}/${b.total} decoded`));
    }
  }

  // Line-scan observation audit rows (t7): stable key=value columns, one
  // row per strip observation, in processing order (deterministic).
  for (const o of observations) {
    if (o.acquisitionKind !== 'LINE_SCAN') continue;
    const value = [
      `kind=${o.acquisitionKind}`,
      `face=${o.face}`,
      `lineCount=${o.lineCount}`,
      `expectedLineCount=${o.expectedLineCount}`,
      `encoderStartMm=${o.encoderStartMm}`,
      `encoderEndMm=${o.encoderEndMm}`,
      `effectivePpm=${o.ppm}`,
      `complete=${o.complete}`,
      ...(o.abortReason !== undefined ? [`abortReason=${o.abortReason}`] : []),
      `decoded=${o.decoded}`,
    ].join(';');
    lines.push(row('observations', o.frameId, value));
  }

  return `${lines.join('\n')}\n`;
}
